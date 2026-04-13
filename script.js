let a, b, op;

window.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("question")) {
        newQ();

        document.getElementById("submit").addEventListener("click", check);

        document.getElementById("answer").addEventListener("keydown", e => {
            if (e.key === "Enter") check();
        });
    }
});

function newQ() {
    a = Math.floor(Math.random() * 10);
    b = Math.floor(Math.random() * 10);

    const ops = ["+", "-", "×"];
    op = ops[Math.floor(Math.random() * 3)];

    document.getElementById("question").innerText = `${a} ${op} ${b}`;
    document.getElementById("answer").value = "";
    document.getElementById("result").innerText = "";
}

function getAnswer() {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "×") return a * b;
}

function check() {
    const val = Number(document.getElementById("answer").value);
    const result = document.getElementById("result");

    if (val === getAnswer()) {
        result.innerText = "Correct";
        result.style.color = "lightgreen";
    } else {
        result.innerText = "Wrong";
        result.style.color = "red";
    }

    setTimeout(newQ, 700);
}
