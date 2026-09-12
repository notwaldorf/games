// ✏️ Add new games here
const GAMES = [
  { title: "Kweens",       emoji: "🐱", color: "#FF8FC0", url: "https://meowni.ca/games/kweens/", note: "it's like queens but with cats" }, // ✏️ add the Kweens link
  { title: "Eprubete",     emoji: "🧪", color: "#86E3C8", url: "https://meowni.ca/eprubete/", note: "it means test tube in romanian" },
  { title: "Score Keeper", emoji: "🏆", color: "#FFD84D", url: "https://meowni.ca/score-keeper/", note: "because we play spades in pubs and don't have paper" }
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

document.getElementById("grid").innerHTML = GAMES.map(g => `
  <a class="tile" href="${esc(g.url)}" style="--c:${esc(g.color)}">
    <div class="tile-top" aria-hidden="true">${g.emoji}</div>
    <div class="tile-body">
      <h2>${esc(g.title)}</h2>
      <p>${esc(g.note)}</p>
    </div>
  </a>`).join("");

// Capsules inside the dome
const spots = [[60,142],[205,142],[82,172],[118,186],[155,188],[188,170],[100,208],[160,210],[98,140],[136,152],[172,138],[118,112],[152,108],[130,206]];
document.getElementById("balls").innerHTML = spots.map(([x, y], i) => `
  <g transform="translate(${x} ${y}) rotate(${(i * 47) % 360})"><g class="ball-inner" style="animation-delay:${(i % 4) * 40}ms">
    <circle r="16" fill="#fff" stroke="#2B2560" stroke-width="3"/>
    <path d="M-16 0 A16 16 0 0 1 16 0 Z" fill="${GAMES[i % GAMES.length].color}" stroke="#2B2560" stroke-width="3" stroke-linejoin="round"/>
  </g></g>`).join("");

// Random picker
const machine = document.getElementById("machine");
const knob = document.getElementById("knob");
const prize = document.getElementById("prize");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let turns = 0, last = -1;

const showCard = g => {
  prize.innerHTML = `<a class="prize-card" href="${esc(g.url)}" style="--c:${esc(g.color)}">
    <span class="prize-icon" aria-hidden="true">${g.emoji}</span><strong>${esc(g.title)}</strong></a>`;
};

machine.addEventListener("click", () => {
  let i;
  do { i = Math.floor(Math.random() * GAMES.length); } while (GAMES.length > 1 && i === last);
  last = i;
  const g = GAMES[i];
  if (reduceMotion) return showCard(g);

  machine.disabled = true;
  knob.style.transform = `rotate(${++turns * 360}deg)`;
  machine.classList.remove("shaking");
  void machine.offsetWidth;
  machine.classList.add("shaking");
  setTimeout(() => {
    prize.innerHTML = `<div class="ball" style="--c:${esc(g.color)}" aria-hidden="true"><span class="top"></span><span class="bottom"></span></div>`;
  }, 550);
  setTimeout(() => { showCard(g); machine.disabled = false; }, 1350);
});
