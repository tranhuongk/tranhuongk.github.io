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

  $('#form').submit(function (e) {
    // event.preventDefault()
    console.log("submited")

    url = 'https://docs.google.com/forms/u/0/d/e/1FAIpQLSeZkLxKjMa0zQzNfnJXeIU4R6Y_R6nSvLyajOekSwIBjDS28A/formResponse'
    data = {
      'entry.2140219019': $('#input').val()
    }

    $.ajax({
      type: "POST",
      url: url,
      data: data,
      dataType: 'json'
    });
  })

  console.log(navigator.userAgent)

});