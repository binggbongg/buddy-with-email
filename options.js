// options.js

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveButton').addEventListener('click', saveOptions);

// Get reference to the status message element
const saveStatusMessage = document.getElementById('saveStatus');

// --- ADD THIS LOG ---
console.log('options.js loaded. saveStatusMessage element:', saveStatusMessage);

// Restores options from chrome.storage.sync
function restoreOptions() {
    chrome.storage.sync.get('notifyEmailAddress', (items) => {
        document.getElementById('emailAdd').value = items.notifyEmailAddress || '';
        console.log('Restored email:', items.notifyEmailAddress); // ADD THIS LOG
    });
}

// Saves options to chrome.storage.sync
function saveOptions() {
    const notifyEmailAddress = document.getElementById('emailAdd').value.trim();

    console.log('Attempting to save email:', notifyEmailAddress); // ADD THIS LOG

    if (notifyEmailAddress && !isValidEmail(notifyEmailAddress)) {
        console.error('Invalid email address entered:', notifyEmailAddress);
        alert('Please enter a valid email address.');
        saveStatusMessage.style.display = 'none'; // Ensure it's hidden if validation fails
        return;
    }

    chrome.storage.sync.set({
        notifyEmailAddress: notifyEmailAddress
    }, () => {
        // This callback runs AFTER the save operation is complete
        console.log('chrome.storage.sync.set callback executed. Saving successful.'); // ADD THIS LOG

        // Show the status message
        if (saveStatusMessage) { // Added a check just in case it's null (though it shouldn't be with DOMContentLoaded)
            saveStatusMessage.style.display = 'block';
            console.log('Save status message set to display: block.'); // ADD THIS LOG
        } else {
            console.error('Error: saveStatus element not found when trying to show message.');
        }


        // Hide the status message after 3 seconds
        setTimeout(() => {
            if (saveStatusMessage) {
                saveStatusMessage.style.display = 'none';
                console.log('Save status message set to display: none (hidden after timeout).'); // ADD THIS LOG
            }
        }, 3000);
    });
}

// Basic email validation function
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}