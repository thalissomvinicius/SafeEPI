const fs = require('fs');

async function run() {
  const res = await fetch('http://localhost:3000/api/remote-links?token=1c50a8c1f9824f25b09792c218188cd431b32f658378d47c8262a13a6e1272b0');
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
