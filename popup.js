// Check configuration and update UI on load
document.addEventListener('DOMContentLoaded', async function() {
  await checkConfiguration();
  await updateStatistics();
});

// Check if Azure configuration exists
async function checkConfiguration() {
  const result = await chrome.storage.local.get(['azureApiKey', 'azureEndpoint', 'azureDeploymentName']);
  const apiKeySection = document.getElementById('apiKeySection');
  const statusDisplay = document.getElementById('statusDisplay');
  const statusText = document.getElementById('statusText');
  const statsSection = document.getElementById('statsSection');
  
  if (!result.azureApiKey || !result.azureEndpoint) {
      // Show API configuration section if not configured
      apiKeySection.style.display = 'block';
      statusDisplay.classList.remove('active');
      statusDisplay.classList.add('inactive');
      statusText.textContent = 'Protection Inactive - Configuration Required';
      statsSection.style.display = 'none';
      
      // Pre-fill any existing values
      if (result.azureEndpoint) {
          document.getElementById('azureEndpoint').value = result.azureEndpoint;
      }
      if (result.azureDeploymentName) {
          document.getElementById('deploymentName').value = result.azureDeploymentName;
      }
  } else {
      // Configuration exists
      apiKeySection.style.display = 'none';
      statusDisplay.classList.remove('inactive');
      statusDisplay.classList.add('active');
      statusText.textContent = 'Protection Active';
      statsSection.style.display = 'block';
  }
}

// Update statistics display
async function updateStatistics() {
  const result = await chrome.storage.local.get(['messagesDetected', 'messagesBlocked']);
  document.getElementById('messagesDetected').textContent = result.messagesDetected || 0;
  document.getElementById('messagesBlocked').textContent = result.messagesBlocked || 0;
}

// Save Azure configuration
document.getElementById('saveConfig').addEventListener('click', async function() {
  const endpoint = document.getElementById('azureEndpoint').value.trim();
  const apiKey = document.getElementById('azureApiKey').value.trim();
  const deploymentName = document.getElementById('deploymentName').value.trim() || 'gpt-4o';
  
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  
  // Hide previous messages
  errorMessage.style.display = 'none';
  successMessage.style.display = 'none';
  
  // Validate inputs
  if (!endpoint) {
      errorMessage.textContent = 'Please enter your Azure endpoint URL';
      errorMessage.style.display = 'block';
      return;
  }
  
  if (!apiKey) {
      errorMessage.textContent = 'Please enter your Azure API key';
      errorMessage.style.display = 'block';
      return;
  }
  
  // Validate endpoint URL format
  try {
      const url = new URL(endpoint);
      if (!url.hostname.includes('openai.azure.com')) {
          errorMessage.textContent = 'Invalid Azure OpenAI endpoint. Should be like: https://your-resource.openai.azure.com';
          errorMessage.style.display = 'block';
          return;
      }
  } catch (e) {
      errorMessage.textContent = 'Invalid endpoint URL format';
      errorMessage.style.display = 'block';
      return;
  }
  
  // Disable button during save
  const saveButton = document.getElementById('saveConfig');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  
  try {
      // Save configuration
      await chrome.storage.local.set({
          azureEndpoint: endpoint,
          azureApiKey: apiKey,
          azureDeploymentName: deploymentName
      });
      
      // Show success message
      successMessage.textContent = 'Configuration saved successfully!';
      successMessage.style.display = 'block';
      
      // Clear API key input for security
      document.getElementById('azureApiKey').value = '';
      
      // Notify background script
      await chrome.runtime.sendMessage({ action: 'apiKeyUpdated' });
      
      // Update UI after short delay
      setTimeout(async () => {
          await checkConfiguration();
          await updateStatistics();
      }, 1500);
      
  } catch (error) {
      console.error('Error saving configuration:', error);
      errorMessage.textContent = 'Failed to save configuration. Please try again.';
      errorMessage.style.display = 'block';
  } finally {
      // Re-enable button
      saveButton.disabled = false;
      saveButton.textContent = 'Save Configuration';
  }
});

// Reset statistics
document.getElementById('resetStats').addEventListener('click', async function() {
  if (confirm('Are you sure you want to reset all statistics?')) {
      await chrome.storage.local.set({
          messagesDetected: 0,
          messagesBlocked: 0
      });
      
      // Update badge
      chrome.action.setBadgeText({ text: '' });
      
      // Update display
      await updateStatistics();
  }
});

// Add edit configuration button functionality
document.getElementById('statusDisplay').addEventListener('click', async function() {
  const statusDisplay = document.getElementById('statusDisplay');
  if (statusDisplay.classList.contains('active')) {
      // Allow editing configuration
      const apiKeySection = document.getElementById('apiKeySection');
      apiKeySection.style.display = 'block';
      
      // Load existing configuration (except API key for security)
      const result = await chrome.storage.local.get(['azureEndpoint', 'azureDeploymentName']);
      if (result.azureEndpoint) {
          document.getElementById('azureEndpoint').value = result.azureEndpoint;
      }
      if (result.azureDeploymentName) {
          document.getElementById('deploymentName').value = result.azureDeploymentName;
      }
  }
});

// Auto-refresh statistics every 5 seconds when popup is open
setInterval(updateStatistics, 5000);