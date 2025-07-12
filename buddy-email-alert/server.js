// server.js (Simplified for email notification only)
const express = require('express');
const cors = require('cors');
const { EmailClient } = require('@azure/communication-email'); 
require('dotenv').config(); 

const app = express();
const port = process.env.PORT || 3000;

const chromeExtensionId = 'kkhmclnemlejinbnbabhhdhmjdkjlpod'; 
const allowedOrigins = [`chrome-extension://${chromeExtensionId}`];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'] 
}));

app.use(express.json()); 

const connectionString = process.env.ACS_CONNECTION_STRING;
const senderAddress = process.env.ACS_SENDER_ADDRESS; 

if (!connectionString || !senderAddress) {
    console.error('ERROR: Azure Communication Services details (ACS_CONNECTION_STRING or ACS_SENDER_ADDRESS) not properly set in environment variables.');
    process.exit(1);
}

const emailClient = new EmailClient(connectionString);

// Endpoint for sending email notifications - This is the core functionality
app.post('/send-notification', async (req, res) => {
    console.log('Received request for /send-notification');

    const { email, threatLevel, reason, originalText } = req.body;

    if (!email || threatLevel === undefined || !reason || !originalText) { // threatLevel can be 0, so check for undefined
        console.warn('Missing required fields in request body. Email, threatLevel, reason, or originalText are missing.');
        return res.status(400).json({ message: "Please provide 'email', 'threatLevel', 'reason', and 'originalText'." });
    }

    try {
        console.log('Attempting to send email via Azure Communication Services...');

        const emailMessage = {
            senderAddress: senderAddress, // Use the sender address from your ACS setup
            recipients: {
                to: [{ address: email }],
            },
            content: {
                subject: `🚨 BantAI Buddy Alert! Message Detected (Severity: ${threatLevel})`,
                html: `
                    <html>
                    <body style="font-family: sans-serif; line-height: 1.6;">
                        <div style="max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                            <h2 style="color: #d9534f;">🚨 BantAI Buddy Alert! 🚨</h2>
                            <p>Dear Parent/Guardian,</p>
                            <p>This is an urgent notification from **BantAI Buddy**. A message with a <b>threat level of ${threatLevel}</b> has been detected.</p>
                            
                            <h3 style="color: #333;">Message Details:</h3>
                            <p><strong>Reason for detection:</strong> ${reason}</p>
                            <p style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; color: #721c24;">
                                <strong>Original Message:</strong> "${originalText}"
                            </p>
                            
                            <p>Please consider having a conversation with your child about safe online communication. You can also review more details within the **BantAI Buddy** extension.</p>
                            
                            <p>Thank you for using **BantAI Buddy** to keep your children safe online.</p>
                            <p style="font-size: 0.9em; color: #888;">The BantAI Buddy Team</p>
                        </div>
                    </body>
                    </html>
                `,
                text: `
                    BantAI Buddy Alert!
                    
                    Dear Parent/Guardian,
                    
                    This is an urgent notification from BantAI Buddy. A message with a threat level of ${threatLevel} has been detected.
                    
                    Message Details:
                    Reason for detection: ${reason}
                    Original Message: "${originalText}"
                    
                    Please consider having a conversation with your child about safe online communication. You can also review more details within the BantAI Buddy extension.
                    
                    Thank you for using BantAI Buddy to keep your children safe online.
                    
                    The BantAI Buddy Team
                `,
            },
        };

        // Use the ACS Email client to send the email
        const poller = await emailClient.beginSend(emailMessage);
        const response = await poller.pollUntilDone();

        console.log('Email send operation ID:', response.id);

        if (response.status === "Succeeded") {
            console.log('Email sent successfully via Azure Communication Services.');
            res.status(200).json({ success: true, message: "Email notification sent successfully via ACS.", messageId: response.id });
        } else {
            console.error(`ACS Email send operation status: ${response.status}. Error details:`, response.error);
            res.status(500).json({ success: false, message: `An error occurred while sending email via ACS: ${response.error?.message || response.status}` });
        }

    } catch (error) {
        console.error('Error sending email via Azure Communication Services:', error.message);
        res.status(500).json({ success: false, message: `An error occurred while sending email: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});