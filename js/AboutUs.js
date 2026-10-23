// Expand or collapse the About page information panel and keep its accessibility state in sync.
$(document).ready(function() {
    $("#flip").click(function() {
        const isExpanded = $(this).attr("aria-expanded") === "true";
        $(this).attr("aria-expanded", String(!isExpanded));
        $("#panel").slideToggle("slow");
    });
});