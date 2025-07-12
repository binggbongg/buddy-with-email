// MessengerGuard Background Script - API Only Version
// Handles Azure OpenAI API calls for content moderation

//for pop up of options.html
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('BantAI Buddy extension installed for the first time. Opening options page...');
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    }
});

// Service Worker setup
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(self.clients.claim());
});

// Initialize storage on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        protectionEnabled: true,
        blockedMessages: {},
        blurredChats: [],
        messagesDetected: 0,
        messagesBlocked: 0
    });
});

// Simple queue for API calls
let apiQueue = [];
let processing = true;

// Shortened system prompt (keep the essential parts for hackathon)
const SYSTEM_PROMPT = `You are an AI assistant that analyzes text messages in Messenger.com and determines if that message is inappropriate for children ages 8-15. You support at most three languages: English, Tagalog, and Cebuano. You may also scan for mixed languages like Taglish or Conyo.

Response Format (JSON):
{
    "shouldBlock": boolean (true or false),
    "reason": "Explain briefly one sentence. Explain it in a way that children ages 8-15 can gain insights."
    "confidence": 0.0-1.0,
    "category": "INSULT|TOXICITY|SEVERE_TOXICITY|SEXUALLY_EXPLICIT|FLIRTATION|PROFANITY|PREDATORY|VIOLENCE|MISINFORMATION|HATE_SPEECH|CYBERBULLYING|SAFE",
    "severity": 1-5,
    "language": "English|Tagalog|Cebuano"
    "slang_detected": "list of detected slang terms",
    "child_risk": "CRITICAL|HIGH|MEDIUM|LOW|NONE",
    "action": "BLOCK|ALLOW"
}
    
Analyze the message deeply and clearly. If it doesn't fall under the patterns of inappropriate messages, do not assume it's inappropriate already.Look for clues that makes the message open for multiple interpretations.

Beware of flirtatious language.

Also, highlight some common patterns to bypass inappropriate messages like number and symbols substitutions and deliberate misspellings.`;

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyzeMessage') {
        analyzeMessage(request.text, request.messageId)
            .then(result => {
                // for email notif feature
                if (result && result.severity >= 1) {
                    console.log('Sending email notification.');
                    notifyUserIfSevere(request.text, result);
                }
                sendResponse(result);
            })
            .catch(error => {
                console.error('Analysis error:', error);
                sendResponse({
                    shouldBlock: false,
                    reasons: [],
                    messageId: request.messageId,
                    error: error.message
                });
            });
        return true; 
    }
});

// Main analysis function
async function analyzeMessage(text, messageId) {
    // Try Azure OpenAI
    try {
        const config = await chrome.storage.local.get(['azureApiKey', 'azureEndpoint', 'azureDeploymentName']);
        if (!config.azureApiKey || !config.azureEndpoint) {
            console.warn('Azure OpenAI not configured');
            return {
                shouldBlock: false,
                reasons: [],
                messageId: messageId,
                error: 'API not configured'
            };
        }
        
        return await callAzureOpenAI(text, messageId, config);
    } catch (error) {
        console.error('Azure API error:', error);
        return {
            shouldBlock: false,
            reasons: [],
            messageId: messageId,
            error: error.message
        };
    }
}

// Azure OpenAI API call
async function callAzureOpenAI(text, messageId, config) {
    const deployment = config.azureDeploymentName || 'gpt-4o';
    const url = `${config.azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': config.azureApiKey
        },
        body: JSON.stringify({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `Analyze: "${text}"` }
            ],
            temperature: 0.1,
            max_tokens: 800
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        if(errorText.includes('content filtering system') || response.status === 400){
            return {
                shouldBlock: true,
                reasons: ['CONTENT_FILTER'],
                messageId,
                confidence: 1.0,
                reason: 'Content filter triggered',
            };
        }
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    try {
        // Clean and parse JSON response
        let cleaned = content.replace(/^```JSON\s*|\s*```$/g, '').trim();
        // Remove any additional backticks or JSON tags that might be present
        cleaned = cleaned.replace(/^```|```$/g, '').trim();
        cleaned = cleaned.replace(/^json\s*|^JSON\s*/i, '').trim();
        
        // Log for debugging
        console.log('Cleaned response:', cleaned);
        
        // Verify we have content to parse
        if (!cleaned) {
            console.error('Empty response from API');
            throw new Error('Empty response from API');
        }
        
        let analysis;
        try {
            analysis = JSON.parse(cleaned);
        } catch (parseError) {
            console.error('JSON Parse Error. Response:', cleaned);
            console.error('Parse error details:', parseError);
            throw new Error(`Failed to parse API response: ${parseError.message}`);
        }
        
        // Validate required fields
        if (!analysis.action || !analysis.category || !analysis.severity) {
            console.error('Invalid analysis format:', analysis);
            throw new Error('Invalid response format from API');
        }
        
        console.log('Parsed analysis:', analysis);
        
        const shouldBlock = analysis.action === 'BLOCK' || analysis.severity >= 2;
        
        if (shouldBlock) {
            await updateCounters(true);
            await storeBlockedMessage(messageId, text, analysis);
            notifyUserIfSevere(text, analysis);
        } else {
            await updateCounters(false);
        }
        
        return {
            shouldBlock,
            reasons: [analysis.category],
            messageId,
            severity: mapSeverity(analysis.severity),
            details: analysis
        };
        
    } catch (error) {
        console.error('Analysis error:', error);
        // Return a safe fallback response
        return {
            shouldBlock: false,
            reasons: ['ERROR'],
            messageId,
            severity: 'medium',
            error: error.message
        };
    }
}

//for email alert
async function notifyUserIfSevere(text, analysis) {
    if (analysis.severity < 3) {
        console.log('Message severity below threshold for email notification.');
        return;
    }

    // Get the recipient email address from storage
    const { notifyEmailAddress } = await chrome.storage.sync.get('notifyEmailAddress');

    // If no email address is configured, cannot send email.
    if (!notifyEmailAddress) {
        console.log('Email notification address not set in extension options.');
        return;
    }

    const emailBackendUrl = 'https://bantai-buddy-alert-service-f4gde7ajgxa4hbet.southeastasia-01.azurewebsites.net/send-notification';

    try {
        console.log(`Sending email notification request for message ID: ${analysis.messageId} to ${notifyEmailAddress}`);
        const response = await fetch(emailBackendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: notifyEmailAddress, // This will be the recipient's email address
                threatLevel: analysis.severity,
                reason: analysis.reason,
                originalText: text
            })
        });

        if (response.ok) {
            console.log('Email notification request sent successfully to backend.');
        } else {
            const errorText = await response.text();
            console.error('Failed to send email notification request to backend:', response.status, errorText);
        }
    } catch (error) {
        console.error('Error making fetch request to email notification backend:', error);
    }
}

// Helper functions
function mapSeverity(num) {
    const map = { 5: 'critical', 4: 'high', 3: 'medium', 2: 'low', 1: 'minimal' };
    return map[num] || 'medium';
}

async function updateCounters(blocked) {
    const data = await chrome.storage.local.get(['messagesDetected', 'messagesBlocked']);
    const newDetected = (data.messagesDetected || 0) + 1;
    const newBlocked = (data.messagesBlocked || 0) + (blocked ? 1 : 0);
    
    await chrome.storage.local.set({
        messagesDetected: newDetected,
        messagesBlocked: newBlocked
    });
    
    if (newBlocked > 0) {
        chrome.action.setBadgeText({ text: newBlocked.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    }
}

async function storeBlockedMessage(messageId, text, analysis) {
    const data = await chrome.storage.local.get(['blockedMessages']);
    const blocked = data.blockedMessages || {};
    
    blocked[messageId] = {
        originalText: text,
        timestamp: Date.now(),
        category: analysis.category,
        severity: analysis.severity,
        reason: analysis.reason
    };
    
    // Keep only last 100 messages
    const sorted = Object.entries(blocked)
        .sort(([,a], [,b]) => b.timestamp - a.timestamp)
        .slice(0, 100);
    
    await chrome.storage.local.set({
        blockedMessages: Object.fromEntries(sorted)
    });
}

// Set initial badge
chrome.action.setBadgeText({ text: '✓' });
chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });