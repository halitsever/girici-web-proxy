jQuery(document).ready(function() {
  function openFancybox() {
    setTimeout(function() {
      jQuery("#popuplink").trigger("click");
    }, 500);
  }
  var ziyaret = jQuery.cookie("ziyaret");
  if (ziyaret == "yes") {
  } else {
    openFancybox();
  }
  jQuery.cookie("ziyaret", "yes", {
    expires: 1
  });
  jQuery("#popuplink").fancybox({
    modal: true,
    maxWidth: 400,
    overlay: { closeClick: true }
  });
});

function oyunlar() {
  window.location = "./oyunlar.html";
}
function sozler() {
  window.location = "./kamyoncusozleri.html";
}
function eglence() {
  window.location = "./eglence.html";
}

function youtube() {
  window.location = "./youtube.html";
}

function webmarket() {
  window.open(
    "market.php",
    "acılacaksayfa",
    "width=400,height=400,menubar=0,toolbar=0,resizable=0"
  );
}
function renk() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2FUntitled-2.png?v=1583258151342')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://www.newshub.co.nz/dam/form-uploaded-images-ordered/2019/08/08/KNOWYOURMEME-sad-cat-crying-1120.JPG')";
}

function renk2() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2FUntitled-2.png?v=1583258151342')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://media-cdn.t24.com.tr/media/library/2020/01/1578568673402-ibrahim-tatlises.jpg')";
}

function renk3() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2Flogo.png?v=1583253881597')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://images.pexels.com/photos/3667816/pexels-photo-3667816.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940')";
}


function renk4() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2FUntitled-2.png?v=1583258151342')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://media.wired.com/photos/59a459d3b345f64511c5e3d4/master/pass/MemeLoveTriangle_297886754.jpg')";
}

function renk5() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2Flogo.png?v=1583253881597')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2FUntitled-1_01.gif?v=1583253628500')";
}

function renk6() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2FUntitled-2.png?v=1583258151342')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://cdn.glitch.com/45ff859d-71c0-4700-af38-7afe6f021c8d%2Fcorona-virusune-karsi-mucadelede-uzmanlardan-gida-tavsiyesi-d-vitamini-1589444579084.jpg?v=1589511953483')";
}


function renk7() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2Flogo.png?v=1583253881597')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://cdn.glitch.com/45ff859d-71c0-4700-af38-7afe6f021c8d%2F3595700_obe55.jpg?v=1589511951457')";
}

function renk8() {
  location.href = "#";
  document.getElementById("ust-taraf").style.backgroundSize = "cover";
  document.getElementById("girici-logo").style.backgroundImage =
    "url('https://cdn.glitch.com/c0a764c7-9345-4319-be50-d1b2f95f17ec%2Flogo.png?v=1583253881597')";
  document.getElementById("girici-logo").style.backgroundSize = "cover";

  document.getElementById("ust-taraf").style.backgroundImage =
    "url('https://cdn.glitch.com/45ff859d-71c0-4700-af38-7afe6f021c8d%2F1553771762215.png?v=1589511950863')";
}

