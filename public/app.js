function animateDuel(player1, player2) {
    const box1 = document.querySelector("#player1");
    const box2 = document.querySelector("#player2");

    if (!box1 || !box2) return;

    const names = window.players || [];

    box1.classList.add("rolling");
    box2.classList.add("rolling");

    let count = 0;

    const interval = setInterval(() => {
        if (names.length) {
            box1.textContent = names[Math.floor(Math.random() * names.length)];
            box2.textContent = names[Math.floor(Math.random() * names.length)];
        }

        count++;
    }, 100);

    setTimeout(() => {
        clearInterval(interval);

        box1.textContent = player1;
        box2.textContent = player2;

        box1.classList.remove("rolling");
        box2.classList.remove("rolling");
    }, 5000);
}
