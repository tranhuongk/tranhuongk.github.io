$(document).ready(function () {
  var show = true;
  $("#buttonmore").on('click', function () {
    $("#intro").slideToggle(200);
    if (show) {
      show = false;
      $("#more").animate(
        { deg: -180 },
        {
          duration: 200,
          step: function (now) {
            $(this).css({ transform: 'rotate(' + now + 'deg)' });
          }
        }
      );
    }
    else {
      show = true;
      $("#more").animate(
        { deg: 0 },
        {
          duration: 200,
          step: function (now) {
            $(this).css({ transform: 'rotate(' + now + 'deg)' });
          }
        }
      );
    }
  });

  document.getElementById('form').target = 'my-response-iframe';
  var iframe = document.getElementById('my-response-iframe');
  if (iframe) {
    iframe.onload = function () {
      document.getElementById("input").value = ''
    }
  }

  console.log(navigator.userAgent)

});