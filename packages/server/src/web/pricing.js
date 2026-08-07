// Pricing slider — $42 per 2 connections, linear, capped at 15 connections.
// $42 / 2 = $21 per connection exactly, so every step lands on a whole dollar.

const $ = (s) => document.querySelector(s);
const PRICE_PER_CONNECTION = 21;

const slider = $("#connSlider");
const connValue = $("#connValue");
const priceValue = $("#priceValue");

function render() {
  const connections = Number(slider.value);
  connValue.textContent = connections;
  priceValue.textContent = `$${connections * PRICE_PER_CONNECTION}`;
}

slider.addEventListener("input", render);
render();
