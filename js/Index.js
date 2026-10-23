// Show the back-to-top control only after the visitor scrolls down the page.
window.addEventListener("scroll", function() {
    var scrollButton = document.getElementById("scrollButton");
    if (window.pageYOffset > 200) {
        scrollButton.style.display = "block";
    } else {
        scrollButton.style.display = "none";
    }
});