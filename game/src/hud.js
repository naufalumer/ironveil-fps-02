// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money,
// killfeed, charge status, buy menu and the overlay panels. It never touches
// the simulation; main.js pushes numbers in and reads the play callback out.
// Every setter is cheap and cached: unchanged values never touch the DOM.
import { WEAPON_DEFS } from './weapons.js';

const COPY = {
  start: {
    title: 'IRONVEIL',
    copy: 'Foundry breach. Plant the charge at A or B, or wipe the defenders. First to 3 rounds takes the foundry.',
    action: 'Click to play',
  },
  paused: { title: 'IRONVEIL', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  dead: { title: 'You are down', copy: 'Your squad fights on. Next round starts soon.', action: 'Spectate' },
};

const BUY_ITEMS = [
  { key: '1', id: 'smg', label: 'Ripper SMG' },
  { key: '2', id: 'rifle', label: 'Anvil Rifle' },
  { key: '3', id: 'marksman', label: 'Longshot DMR' },
  { key: '4', id: 'smoke', label: 'Smoke grenade' },
  { key: '5', id: 'flash', label: 'Flash grenade' },
];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreAtk = $('score-atk');
  const scoreDef = $('score-def');
  const roundValue = $('round-value');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const bombStatus = $('bomb-status');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const hint = $('hint');
  const grenadeLine = $('grenades');
  const vignette = $('damage-vignette');
  const chargeCarry = $('charge-carry');

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  // Build the buy menu rows once; update prices/owned state per render.
  const buyRows = {};
  for (const item of BUY_ITEMS) {
    const li = document.createElement('li');
    const price = item.id === 'smoke' ? 250 : item.id === 'flash' ? 150 : WEAPON_DEFS[item.id].price;
    li.innerHTML = `<kbd>${item.key}</kbd><span>${item.label}</span><b>$${price}</b>`;
    buyList.appendChild(li);
    buyRows[item.id] = { li, price };
  }

  return {
    setHealth(value) {
      const v = Math.max(0, Math.round(value));
      if (last.health === v) return;
      last.health = v;
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
      healthNum.textContent = String(v);
      vignette.style.opacity = v <= 30 ? String((30 - v) / 30 * 0.55) : '0';
    },
    setAmmo(mag, reserve, weaponKey) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', WEAPON_DEFS[weaponKey].name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
    },
    setGrenades(smoke, flash, selected) {
      setText(grenadeLine, 'grenades', `Smoke ${smoke} · Flash ${flash} — [4]/[5] select, [G] throw (${selected})`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = phase === 'BUY' ? `BUY ${s}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      $('timer').classList.toggle('buy', phase === 'BUY');
      $('timer').classList.toggle('urgent', phase !== 'BUY' && s <= 10);
    },
    setScore(atk, def, round) {
      setText(scoreAtk, 'atk', String(atk));
      setText(scoreDef, 'def', String(def));
      setText(roundValue, 'round', `ROUND ${round} / 5`);
    },
    setCrosshairGap(px) {
      const v = Math.round(px);
      if (last.gap === v) return;
      last.gap = v;
      crosshair.style.setProperty('--gap', `${v}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = `feed-row ${killerTeam}`;
      row.innerHTML = `<b>${killer}</b> ${headshot ? '◎' : '—'} <b>${victim}</b>`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    damageFrom(angleDeg) {
      const arc = document.createElement('div');
      arc.className = 'dmg-arc';
      arc.style.transform = `rotate(${angleDeg}deg)`;
      $('damage-dir').appendChild(arc);
      setTimeout(() => arc.remove(), 900);
    },
    setBomb(text, kind) {
      setText(bombStatus, 'bomb', text);
      bombStatus.className = kind ? `show ${kind}` : '';
    },
    setChargeCarry(show) {
      chargeCarry.classList.toggle('show', show);
    },
    setHint(text) {
      setText(hint, 'hint', text);
      hint.classList.toggle('show', !!text);
    },
    showBuyMenu(show, money, owned) {
      buyMenu.classList.toggle('show', show);
      if (!show) return;
      for (const item of BUY_ITEMS) {
        const row = buyRows[item.id];
        const afford = money >= row.price;
        const has = item.id === 'smoke' || item.id === 'flash' ? false : !!owned[item.id];
        row.li.classList.toggle('cant', !afford);
        row.li.classList.toggle('owned', has);
      }
    },
    showBanner(titleText, subText, kind, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.className = `show ${kind || ''}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.className = ''; }, ms);
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      if (!text) return;
      title.textContent = text.title;
      copy.textContent = mode === 'dead' && data ? `${text.copy}` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    showMatchOverlay(won, atk, def) {
      title.textContent = won ? 'FOUNDRY TAKEN' : 'FOUNDRY LOST';
      copy.textContent = `Final score — Attackers ${atk} · Defenders ${def}. ${won ? 'The charge did its work.' : 'The defenders held the foundry.'}`;
      play.textContent = 'Play again';
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
