// Legacy shopping-page helpers: slide the bag panel, manage items, and update its total.
// var counter = 0;

// function slapDiv() {
//     var myDiv = document.getElementById("myDiv");
//     counter += 1;

//     if (counter % 2 == 0) {
//         myDiv.style.left = "-26%";
//     } else {
//         myDiv.style.left = "0";
//     }
// }
// Toggle the legacy bag panel's width between open and closed states.
var counter = 0;

function slapDiv() {
    counter += 1;

    if (counter % 2 === 0) {
        $("#myDiv").animate({
            width: "26%"
        }, 400);
    } else {
        $("#myDiv").animate({
            width: "0"
        }, 400);
    }
}


// Build a cart entry with its image, description, price, and remove action.
var totalPrice = 0;

function addToCart(imageSrc, desc, price) {

    // cart-item ----> {first---->{img},secound---->{p,h4}},third----->{button}}
    // totalprice = oldtotalprice + price img
    // updateprice clear all item in the totalDiv ------->
    // 
    var newItem = document.createElement("div");
    newItem.classList.add("cart-items");

    var firstDiv = document.createElement("div");
    firstDiv.classList.add("img");
    newItem.appendChild(firstDiv);


    var imageElement = document.createElement("img");
    imageElement.src = imageSrc;
    firstDiv.appendChild(imageElement);

    var secondDiv = document.createElement("div");
    secondDiv.classList.add("txt");
    newItem.appendChild(secondDiv);


    var paragraph = document.createElement("p");
    paragraph.innerText = desc;
    secondDiv.appendChild(paragraph);


    var priceElement = document.createElement("h4");
    photo = String(price);
    priceElement.innerText = "PKR " + photo;
    secondDiv.appendChild(priceElement);

    var thirdDiv = document.createElement("div");
    thirdDiv.classList.add("div-remove");
    newItem.appendChild(thirdDiv);

    var btn = document.createElement("button");
    btn.classList.add("remove");
    btn.innerText = "Remove";
    btn.addEventListener('click', function() {

        newItem.remove();
        totalPrice -= parseFloat(price)
        updateTotalPrice();
    });
    thirdDiv.appendChild(btn);

    var myDiv = document.getElementById("myDiv");
    myDiv.appendChild(newItem);

    totalPrice += parseFloat(price);
    updateTotalPrice();

}

// Rebuild the legacy cart total and show its checkout control while items remain.
function updateTotalPrice() {
    var divTotal = document.getElementById("divTotal");
    // clear the content of the div 
    divTotal.innerHTML = '';
    //divTotal---> {  div --> {strong , span},{button}   }
    var div = document.createElement("div")
    var totalStrong = document.createElement("strong");
    totalStrong.classList.add("total")
    totalStrong.innerText = "Total Price: PKR ";
    div.appendChild(totalStrong)
    var priceSpan = document.createElement("span");
    priceSpan.innerText = totalPrice.toFixed(2);
    div.appendChild(priceSpan)
    divTotal.appendChild(div);
    var checkoutButton = document.createElement("button");
    checkoutButton.classList.add("checkout")
    checkoutButton.innerText = "Check Out";
    divTotal.appendChild(checkoutButton);
    if (totalPrice == 0.00) {
        divTotal.innerHTML = '';
    }
}


// Read the legacy category query parameter and capture the matching product sections.
var urlParams = new URLSearchParams(window.location.search);
var category = urlParams.get('category');
var man = document.getElementById('man');
var women = document.getElementById('women');
var children = document.getElementById('children');
var headMan = document.getElementById('head-man');
var headWomen = document.getElementById('head-women');
var headChild = document.getElementById('head-child');


// Navigate to the legacy collection page with the selected audience filter.
function classifyMan() {
    window.location.href = "OurOffers.html?category=man";
}

function classifyWomen() {
    window.location.href = "OurOffers.html?category=women";
}

function classifyChild() {
    window.location.href = "OurOffers.html?category=children";
}


// Hide unrelated audience sections when the legacy page opens with a category filter.
document.addEventListener('DOMContentLoaded', function() {

    if (category === 'man') {
        women.style.display = "none";
        children.style.display = "none";
        headWomen.style.display = "none";
        headChild.style.display = "none";
    } else if (category === 'women') {
        man.style.display = "none";
        headMan.style.display = "none";
        children.style.display = "none";
        headChild.style.display = "none";
    } else if (category === 'children') {
        man.style.display = "none";
        women.style.display = "none";
        headMan.style.display = "none";
        headWomen.style.display = "none";
    }
});