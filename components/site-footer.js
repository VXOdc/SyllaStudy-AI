document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector("[data-site-footer]")) {
        return;
    }

    const host = document.querySelector("[data-footer-host]");
    if (!host) {
        return;
    }

    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.setAttribute("data-site-footer", "");
    footer.innerHTML = `
        <div class="site-footer__inner">
            <div class="site-footer__meta">© 2026 SyllaStudy AI. All rights reserved.</div>
            <div class="site-footer__nav" aria-label="Footer navigation">
                <div class="site-footer__group">
                    <span class="site-footer__label">Navigation</span>
                    <div class="site-footer__links footer-links">
                        <a href="/index.html">Home</a>
                        <a href="/index.html">Dashboard</a>
                        <a href="/index.html#features">Features</a>
                        <a href="/about.html#contact">Contact</a>
                        <a href="/about.html">About</a>
                    </div>
                </div>
                <div class="site-footer__group">
                    <span class="site-footer__label">Legal</span>
                    <div class="site-footer__links footer-links">
                        <a href="/terms.html">Terms of Service</a>
                        <a href="/privacy.html">Privacy Policy</a>
                    </div>
                </div>
            </div>
        </div>
    `;

    host.appendChild(footer);

    const findScrollRoot = () => {
        let node = host.parentElement;

        while (node && node !== document.body) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY || style.overflow;

