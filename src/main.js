const status = document.querySelector('#app-status');

if (!(status instanceof HTMLElement)) {
  throw new Error('The application status element is missing');
}
