const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const app = express();

const credentialsPath = path.join(__dirname, 'credentials.json');
const tokenPath = path.join(__dirname, 'token.json');
const bookingsPath = path.join(__dirname, 'bookings.json');

let bookings = [];

if (fs.existsSync(bookingsPath)) {
  bookings = JSON.parse(fs.readFileSync(bookingsPath, 'utf8'));
}

const credentials = JSON.parse(fs.readFileSync(credentialsPath));
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

if (fs.existsSync(tokenPath)) {
  const token = JSON.parse(fs.readFileSync(tokenPath));
  oAuth2Client.setCredentials(token);
}

app.use('/graphics', express.static('/data/data/com.termux/line/graphics'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar']
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', (req, res) => {
  const code = req.query.code;
  oAuth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('Error retrieving access token', err);
      res.status(500).send('Error retrieving access token');
      return;
    }
    oAuth2Client.setCredentials(token);
    fs.writeFile(tokenPath, JSON.stringify(token), (err) => {
      if (err) {
        console.error('Error saving token', err);
        res.status(500).send('Error saving token');
        return;
      }
      console.log('Token stored to', tokenPath);
      res.send('Login successful! Token stored.');
    });
  });
});

function isOverlappingBooking(newBooking) {
  const newStart = new Date(newBooking.start.dateTime).getTime();
  const newEnd = new Date(newBooking.end.dateTime).getTime();
  const technician = newBooking.description.split('ช่างที่ดำเนินงาน: ')[1].split('\n')[0];

  for (let booking of bookings) {
    if (booking.technician === technician) {
      const existingStart = new Date(booking.start).getTime();
      const existingEnd = new Date(booking.end).getTime();

      if (
        (newStart >= existingStart - 3600000 && newStart <= existingEnd + 3600000) ||
        (newEnd >= existingStart - 3600000 && newEnd <= existingEnd + 3600000) ||
        (newStart <= existingStart - 3600000 && newEnd >= existingEnd + 3600000)
      ) {
        return true;
      }
    }
  }
  return false;
}

app.post('/addevent', (req, res) => {
  const eventData = req.body;

  if (isOverlappingBooking(eventData)) {
    res.json({ error: 'Technician already booked for the selected time or within 1 hour of another booking. Please choose a different time.' });
    return;
  }

  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  calendar.events.insert({
    calendarId: 'primary',
    resource: eventData
  }, (err, event) => {
    if (err) {
      console.error('Error adding event:', err);
      res.status(500).json({ error: 'Failed to add event' });
      return;
    }
    console.log('Event added:', event.data);

    bookings.push({
      technician: eventData.description.split('ช่างที่ดำเนินงาน: ')[1].split('\n')[0],
      start: eventData.start.dateTime,
      end: eventData.end.dateTime
    });
    fs.writeFile(bookingsPath, JSON.stringify(bookings, null, 2), (err) => {
      if (err) {
        console.error('Error saving :', err);
        res.status(500).json({ error: 'Failed to save' });
        return;
      }
      res.json({ message: 'Event added successfully', event: event.data });
    });
  });
});

app.get('/checkAvailability', (req, res) => {
  const datetime = new Date(req.query.datetime);
  const availableTechnicians = [
    { id: 'tech1', name: 'ทีมช่าง A' },
    { id: 'tech2', name: 'ทีมช่าง B' },
    { id: 'tech3', name: 'ทีมช่าง C' }
  ];

  const response = availableTechnicians.map(tech => {
    const techBookings = bookings.filter(b => b.technician === tech.name);

    const isAvailable = !techBookings.some(b => {
      const bookingStart = new (b.start).getTime();
      const bookingEnd = new Date(b.end).getTime();
      const selectedStart = datetime.getTime();
      const selectedEnd = selectedStart + 3600000;

      return (
        (selectedStart >= bookingStart - 3600000 && selectedStart <= bookingEnd + 3600000) ||
        (selectedEnd >= bookingStart - 3600000 && selectedEnd <= bookingEnd + 3600000) ||
        (selectedStart <= bookingStart - 3600000 && selectedEnd >= bookingEnd + 3600000)
      );
    });

    return {
      id: tech.id,
      name: tech.name,
      available: isAvailable
    };
  });

  res.json({ technicians: response });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
