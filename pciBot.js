const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);

const app = express();
const port = process.env.PORT || 2000;

app.use(bodyParser.json());

// Webhook route
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const setWebhook = async () => {
  const url = `https://pcifounder.vercel.app/bot${token}`;
  try {
    const result = await bot.setWebHook(url);
    console.log('Webhook set result:', result);
  } catch (error) {
    console.error('Error setting webhook:', error);
  }
};

setWebhook();

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


const waitForCoordinates = {};

const keyboard = [
  [{ text: '/reset' }],
  [{ text: '/pci' }]
];

const replyOptions = { reply_markup: { keyboard, one_time_keyboard: true, resize_keyboard: true } };

// Function to display locations based on the shortest distance
const displayShortestDistance = (kmlData, latitude, longitude) => {
  let shortestDistance = Infinity;
  let closestLocation = null;

  for (const entry of kmlData) {
    const distance = entry.distance;
    if (distance < shortestDistance) {
      shortestDistance = distance;
      closestLocation = entry;
    }
  }

  return closestLocation;
};

// /reset command handler
bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  delete waitForCoordinates[chatId];
  bot.sendMessage(chatId, 'Operation cancelled. Please choose an option:', replyOptions);
  log(`Reset command executed by user ${chatId}`);
});

// /PCI command handler
bot.onText(/\/pci/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Please enter the PCI name:');
  waitForCoordinates[chatId] = { stage: 'PCIName' };
  log(`PCI command triggered by user ${chatId}`);
});

// Callback query handler
bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;

  if (callbackQuery.data === 'reset') {
    delete waitForCoordinates[chatId];
    bot.sendMessage(chatId, 'Operation cancelled. Please choose an option:', replyOptions);
    log(`Reset command executed by user ${chatId}`);
  }
});

// /start command handler
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome! Choose an option:', replyOptions);
  log(`Start command executed by user ${chatId}`);
});

// Text message handler
bot.on('text', (msg) => {
  const chatId = msg.chat.id;

  if (waitForCoordinates[chatId]) {
    const currentStage = waitForCoordinates[chatId].stage;

    if (currentStage === 'coordinates') {
      const [latitude, longitude] = msg.text.split(',').map(coord => parseFloat(coord.trim()));

      if (isNaN(latitude) || isNaN(longitude)) {
        bot.sendMessage(chatId, 'Invalid coordinates format. Please enter again:');
        log(`Invalid coordinates format entered by user ${chatId}`);
        return;
      }

      log(`Coordinates received from user ${chatId}: Latitude - ${latitude}, Longitude - ${longitude}`);

      if (waitForCoordinates[chatId].PCIName) {
        const pciName = waitForCoordinates[chatId].PCIName;

        try {
          const xmlData = fs.readFileSync('tdd.kml', 'utf-8');
          parseString(xmlData, { explicitArray: false }, (err, result) => {
            if (err) {
              console.error('Error parsing XML:', err);
              bot.sendMessage(chatId, 'Error parsing XML. Please try again.');
              log(`Error parsing XML: ${err}`);
              return;
            }

            // Check if the expected properties exist in the parsed result
            if (!result.kml || !result.kml.Document || !result.kml.Document.Folder || !result.kml.Document.Folder.Placemark) {
              console.error('Invalid KML structure: Missing Placemark elements.');
              bot.sendMessage(chatId, 'Invalid KML structure: Missing Placemark elements.');
              log('Invalid KML structure: Missing Placemark elements');
              return;
            }

            const placemarks = result.kml.Document.Folder.Placemark;
            let pciFound = false;

            const kmlData = placemarks.map(placemark => {
              if (placemark.ExtendedData && placemark.ExtendedData.SchemaData) {
                const schemaData = placemark.ExtendedData.SchemaData;
                const dataEntry = {};

                schemaData.SimpleData.forEach(simpleData => {
                  dataEntry[simpleData.$.name] = simpleData._;
                });

                if (dataEntry.PCI === pciName) {
                  pciFound = true;
                  const pciLatitude = parseFloat(dataEntry.y);
                  const pciLongitude = parseFloat(dataEntry.x);

                  const distance = geolib.getDistance(
                    { latitude, longitude },
                    { latitude: pciLatitude, longitude: pciLongitude }
                  ) / 1000; // Convert to kilometers

                  const bearing = Math.round(geolib.getRhumbLineBearing(
                    { latitude, longitude },
                    { latitude: pciLatitude, longitude: pciLongitude }
                  )); // Round bearing

                  return {
                    pciName,
                    saturation: dataEntry.saturation,
                    site: dataEntry.site,
                    hba: dataEntry.HBA,
                    distance,
                    bearing,
                    gmapsLink: `https://maps.google.com/maps?q=${pciLatitude},${pciLongitude}`
                  };
                }
              }
              return null;
            }).filter(Boolean);

            if (kmlData.length > 0) {
              const closestLocation = displayShortestDistance(kmlData, latitude, longitude);
              bot.sendMessage(chatId, `*PCI:* ${closestLocation.pciName}\n*Saturé ?:* ${closestLocation.saturation}\n*Site:* ${closestLocation.site}\nHBA: ${closestLocation.hba}m\n\n*Distance:* ${closestLocation.distance.toFixed(2)} klm\n*Azimuth:* ${closestLocation.bearing}°\n\n*Location Site:* ${closestLocation.gmapsLink}`, { parse_mode: "Markdown" });
              log(`Details sent to user ${chatId}: PCI - ${closestLocation.pciName}, Site - ${closestLocation.site}, HBA - ${closestLocation.hba}, Distance - ${closestLocation.distance.toFixed(2)} kilometers, Bearing - ${closestLocation.bearing}°`);
            } else {
              bot.sendMessage(chatId, `PCI ${pciName} not found.`);
              log(`PCI ${pciName} not found for user ${chatId}`);
            }

            delete waitForCoordinates[chatId];
            log(`PCI calculation completed for user ${chatId}`);
          });
        } catch (error) {
          console.error('Error reading KML file:', error);
          bot.sendMessage(chatId, 'Error reading KML file. Please try again.');
          log(`Error reading KML file: ${error}`);
        }
      } else {
        bot.sendMessage(chatId, 'No PCI name provided.');
        log(`No PCI name provided for user ${chatId}`);
      }
    } else if (currentStage === 'PCIName') {
      const pciName = msg.text.trim();
      bot.sendMessage(chatId, 'Please enter GPS coordinate (e.g., 36.448097, 10.744221):');
      waitForCoordinates[chatId].PCIName = pciName;
      waitForCoordinates[chatId].stage = 'coordinates';
      log(`PCI name received from user ${chatId}: ${pciName}`);
    }
  }
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  log(`Server started on port ${port}`);
});

// Log function
function log(message) {
  console.log(message);
  // You can add code here to save logs to a file or external logging service
}
