let a, b, op;

window.addEventListener("DOMContentLoaded", () => {

    if (!document.getElementById("q")) return;

    newQ();

    document.getElementById("btn").addEventListener("click", check);

    document.getElementById("a").addEventListener("keydown", e => {
        if (e.key === "Enter") check();
    });
});

function newQ() {
    a = Math.floor(Math.random() * 12);
    b = Math.floor(Math.random() * 12);

    const ops = ["+", "-", "×"];
    op = ops[Math.floor(Math.random() * 3)];

    document.getElementById("q").innerText = `${a} ${op} ${b}`;
    document.getElementById("a").value = "";
    document.getElementById("r").innerText = "";
}

function answer() {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "×") return a * b;
}

function check() {
    const val = Number(document.getElementById("a").value);
    const r = document.getElementById("r");

    if (val === answer()) {
        r.innerText = "Correct";
        r.style.color = "lightgreen";
    } else {
        r.innerText = "Wrong";
        r.style.color = "red";
    }

    setTimeout(newQ, 700);
}
