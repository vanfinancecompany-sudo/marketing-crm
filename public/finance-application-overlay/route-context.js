const params = new URLSearchParams(window.location.search);
const applicationRoute = params.get('applicationRoute') || '';
const vehicleTitle = params.get('vehicleTitle') || '';
const vehicleInfo = params.get('vehicleInfo') || '';

const routeInput = document.getElementById('applicationRoute');
if (routeInput && applicationRoute) routeInput.value = applicationRoute;

if (!vehicleTitle && !vehicleInfo && applicationRoute === 'General Finance Application') {
  const title = document.getElementById('vehicleTitleDisplay');
  const detail = document.getElementById('vehicleInfoDisplay');
  const kicker = document.querySelector('.vehicle-kicker');

  if (kicker) kicker.textContent = 'Finance application';
  if (title) title.textContent = 'Apply before choosing your van';
  if (detail) detail.textContent = 'No vehicle is attached to this application. You can choose one after approval.';
}
