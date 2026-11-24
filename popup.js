document.getElementById('open-meet').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://meet.google.com/' });
});
