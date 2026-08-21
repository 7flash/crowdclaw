import { render } from "tradjs/client";

type Call = "UP" | "DOWN" | null;

type Round = {
  label: string;
  icon: string;
  price: number;
  drift: number;
  velocity: number;
  timer: number;
  call: Call;
  resolved: boolean;
};

export default function mount() {
  const root = document.querySelector("#game-root") as HTMLElement | null;
  if (!root) return () => {};

  render(
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: "620px",
        background: "#080b16",
        color: "#edf5ff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "min(940px, 100%)",
          padding: "14px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "10px",
            marginBottom: "9px",
          }}
        >
          <div>
            <b style={{ color: "#76f7c5", letterSpacing: "2px" }}>
              SIGNAL RUSH
            </b>
            <span style={{ color: "#8291ad", fontSize: "12px" }}>
              {" "}
              // predict the next move
            </span>
          </div>
          <div data-status style={{ color: "#ffcf70", fontSize: "12px" }}>
            LIVE MARKET
          </div>
        </div>
        <canvas
          data-game
          width="900"
          height="460"
          style={{
            width: "100%",
            display: "block",
            borderRadius: "12px",
            border: "1px solid #273352",
            background: "#0d1325",
            cursor: "crosshair",
            touchAction: "none",
          }}
        />
        <div style={{ display: "flex", gap: "10px", marginTop: "11px" }}>
          <button
            data-up
            style={{
              flex: "1",
              minHeight: "52px",
              border: "1px solid #36c994",
              borderRadius: "9px",
              background: "#102d29",
              color: "#76f7c5",
              fontWeight: "800",
              letterSpacing: "1px",
              cursor: "pointer",
            }}
          >
            ▲ UP <small>(W / ↑)</small>
          </button>
          <button
            data-down
            style={{
              flex: "1",
              minHeight: "52px",
              border: "1px solid #ec5d80",
              borderRadius: "9px",
              background: "#321924",
              color: "#ff91aa",
              fontWeight: "800",
              letterSpacing: "1px",
              cursor: "pointer",
            }}
          >
            ▼ DOWN <small>(S / ↓)</small>
          </button>
          <button
            data-restart
            style={{
              minWidth: "114px",
              border: "1px solid #63708e",
              borderRadius: "9px",
              background: "#19223a",
              color: "#d7e3ff",
              fontWeight: "800",
              cursor: "pointer",
            }}
          >
            RESTART
          </button>
        </div>
        <div
          style={{
            color: "#8291ad",
            fontSize: "11px",
            textAlign: "center",
            marginTop: "9px",
          }}
        >
          Choose before the clock expires. First to 12 points wins; 3 misses
          ends your run.
        </div>
      </div>
    </div>,
    root,
  );

  const canvas = root.querySelector<HTMLCanvasElement>("[data-game]");
  const status = root.querySelector<HTMLElement>("[data-status]");
  const upButton = root.querySelector<HTMLButtonElement>("[data-up]");
  const downButton = root.querySelector<HTMLButtonElement>("[data-down]");
  const restartButton = root.querySelector<HTMLButtonElement>("[data-restart]");
  if (!canvas || !status || !upButton || !downButton || !restartButton)
    throw new Error("game UI failed to mount");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  let raf = 0;
  let last = performance.now();
  let active = true;
  let flash = 0;
  let note = "WATCH THE TICKER";
  let noteColor = "#d7e3ff";
  let history: number[] = [];
  let player = 0;
  let bots = [0, 0];
  let streak = 0;
  let misses = 0;
  let finished = false;
  let round: Round;

  const events = [
    ["RATE CUT RUMOR", "◒"],
    ["ORBITAL LAUNCH", "◉"],
    ["HEATWAVE ALERT", "☀"],
    ["EARNINGS LEAK", "▣"],
    ["PORT CLOSURE", "⚓"],
    ["QUANTUM PATCH", "◆"],
  ];

  function newRound() {
    const event = events[Math.floor(Math.random() * events.length)];
    const price = 54 + Math.random() * 30;
    const drift =
      (Math.random() < 0.5 ? -1 : 1) * (0.32 + Math.random() * 0.56);
    round = {
      label: event[0],
      icon: event[1],
      price,
      drift,
      velocity: 0,
      timer: 2.9,
      call: null,
      resolved: false,
    };
    history = Array.from(
      { length: 52 },
      (_, i) => price - drift * (52 - i) * 0.32 + (Math.random() - 0.5) * 3,
    );
    note = "FORECAST THE CLOSE";
    noteColor = "#d7e3ff";
  }

  function reset() {
    player = 0;
    bots = [0, 0];
    streak = 0;
    misses = 0;
    finished = false;
    flash = 0;
    newRound();
    status.textContent = "LIVE MARKET";
    status.style.color = "#ffcf70";
  }

  function choose(call: Call) {
    if (finished || round.call || round.resolved) return;
    round.call = call;
    note = call === "UP" ? "LOCKED: BULLISH" : "LOCKED: BEARISH";
    noteColor = call === "UP" ? "#76f7c5" : "#ff91aa";
  }

  function resolve() {
    const actual: Call = round.drift > 0 ? "UP" : "DOWN";
    const hit = round.call === actual;
    const botLuck = () => Math.random() < 0.52;
    bots = bots.map((score) => score + (botLuck() ? 1 : 0));
    if (hit) {
      streak++;
      const gain = streak >= 3 ? 2 : 1;
      player += gain;
      note = gain === 2 ? "HOT STREAK! +2" : "CORRECT +1";
      noteColor = "#76f7c5";
      flash = 0.45;
    } else {
      streak = 0;
      misses++;
      note = round.call ? "WRONG CALL" : "NO FORECAST";
      noteColor = "#ff819d";
      flash = -0.45;
    }
    round.resolved = true;
    if (player >= 12 || misses >= 3) {
      finished = true;
      const win = player >= 12;
      status.textContent = win ? "MARKET MASTER" : "RUN ENDED";
      status.style.color = win ? "#76f7c5" : "#ff819d";
      note = win ? "YOU OUTPACED THE BOTS" : "THREE MISSES — RETRY";
    } else {
      window.setTimeout(newRound, 680);
    }
  }

  function rounded(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function text(
    value: string,
    x: number,
    y: number,
    size = 14,
    color = "#d7e3ff",
    align: CanvasTextAlign = "left",
  ) {
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }

  function draw() {
    const w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0d1325";
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 45) {
      ctx.strokeStyle = "#17213a";
      ctx.beginPath();
      ctx.moveTo(x, 74);
      ctx.lineTo(x, 372);
      ctx.stroke();
    }
    for (let y = 82; y < 373; y += 42) {
      ctx.strokeStyle = "#17213a";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#111a2e";
    rounded(15, 14, w - 30, 49, 8);
    text(round.icon, 31, 46, 25, "#ffcf70");
    text(round.label, 64, 38, 16, "#edf5ff");
    text(
      `CLOSE IN ${Math.max(0, round.timer).toFixed(1)}s`,
      w - 27,
      38,
      15,
      round.timer < 1 ? "#ff819d" : "#ffcf70",
      "right",
    );
    text(`PRICE ${round.price.toFixed(1)}`, 64, 54, 11, "#8291ad");

    const min = Math.min(...history) - 2,
      max = Math.max(...history) + 2;
    const chartX = 22,
      chartY = 82,
      chartW = w - 44,
      chartH = 268;
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = chartX + (i * chartW) / (history.length - 1);
      const y = chartY + chartH - ((v - min) / (max - min)) * chartH;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    const up = history[history.length - 1] > history[0];
    ctx.strokeStyle = up ? "#54e3ae" : "#f06c8d";
    ctx.lineWidth = 3;
    ctx.stroke();
    const lastPrice = history[history.length - 1];
    const py = chartY + chartH - ((lastPrice - min) / (max - min)) * chartH;
    ctx.fillStyle = up ? "#76f7c5" : "#ff91aa";
    ctx.beginPath();
    ctx.arc(chartX + chartW, py, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111a2e";
    rounded(15, 383, w - 30, 61, 8);
    text(`YOU  ${player}/12`, 32, 409, 16, "#edf5ff");
    text(`STREAK ×${streak}`, 32, 431, 12, streak >= 3 ? "#ffcf70" : "#8291ad");
    text(
      `MISSES ${"●".repeat(misses)}${"○".repeat(3 - misses)}`,
      w / 2,
      409,
      13,
      "#ff819d",
      "center",
    );
    text(
      `NOVA ${bots[0]}   ECHO ${bots[1]}`,
      w - 32,
      409,
      14,
      "#aab9d6",
      "right",
    );
    text(note, w - 32, 431, 13, noteColor, "right");

    if (round.call && !round.resolved) {
      ctx.fillStyle = round.call === "UP" ? "#76f7c5" : "#ff91aa";
      text(`YOUR CALL: ${round.call}`, w / 2, 103, 13, ctx.fillStyle, "center");
    }
    if (finished) {
      ctx.fillStyle = "rgba(5,8,18,.79)";
      ctx.fillRect(0, 0, w, h);
      text(
        player >= 12 ? "YOU WIN" : "PREDICTION FAILED",
        w / 2,
        205,
        31,
        player >= 12 ? "#76f7c5" : "#ff819d",
        "center",
      );
      text(
        `FINAL SCORE ${player}  •  NOVA ${bots[0]}  •  ECHO ${bots[1]}`,
        w / 2,
        238,
        14,
        "#d7e3ff",
        "center",
      );
      text(
        "PRESS R OR RESTART TO PLAY AGAIN",
        w / 2,
        274,
        13,
        "#ffcf70",
        "center",
      );
    }
    if (flash) {
      ctx.fillStyle =
        flash > 0 ? "rgba(72,235,170,.13)" : "rgba(250,70,110,.13)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  function loop(now: number) {
    if (!active) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!finished && !round.resolved) {
      round.timer -= dt;
      round.velocity += round.drift * dt * 0.72;
      round.velocity *= 0.92;
      round.price +=
        round.velocity + round.drift * dt * 0.7 + (Math.random() - 0.5) * 0.18;
      history.push(round.price);
      history.shift();
      if (round.timer <= 0) resolve();
    }
    if (flash) flash *= 0.87;
    draw();
    raf = requestAnimationFrame(loop);
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w")
      choose("UP");
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s")
      choose("DOWN");
    if (event.key.toLowerCase() === "r") reset();
  };
  const onCanvas = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    choose(event.clientY - box.top < box.height / 2 ? "UP" : "DOWN");
  };
  upButton.addEventListener("click", () => choose("UP"));
  downButton.addEventListener("click", () => choose("DOWN"));
  restartButton.addEventListener("click", reset);
  canvas.addEventListener("pointerdown", onCanvas);
  window.addEventListener("keydown", onKey);
  reset();
  raf = requestAnimationFrame(loop);

  return () => {
    active = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown", onCanvas);
    render(null, root);
  };
}
