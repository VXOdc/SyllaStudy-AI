let a, b, op;

// wait until page is fully ready
document.addEventListener("DOMContentLoaded", () => {

    if (document.getElementById("question")) {
        newQuestion();

        document.getElementById("submit").addEventListener("click", check);

        document.getElementById("answer").addEventListener("keydown", e => {
            if (e.key === "Enter") check();
        });
    }
});

function newQuestion() {
    a = Math.floor(Math.random() * 12);
    b = Math.floor(Math.random() * 12);

    const ops = ["+", "-", "×"];
    op = ops[Math.floor(Math.random() * ops.length)];

    document.getElementById("question").innerText = `${a} ${op} ${b}`;
    document.getElementById("answer").value = "";
    document.getElementById("result").innerText = "";
}

function solve() {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "×") return a * b;
}

function check() {
    const val = Number(document.getElementById("answer").value);
    const result = document.getElementById("result");

    if (val === solve()) {
        result.innerText = "Correct";
        result.style.color = "lightgreen";
    } else {
        result.innerText = "Wrong";
        result.style.color = "red";
    }

    setTimeout(newQuestion, 700);
}
