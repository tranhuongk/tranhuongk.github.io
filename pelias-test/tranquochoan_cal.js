$(document).ready(function () {

    var type = getUrlVars()["type"]
    var data
    var tqh = tqh_street
    if (type == null) {
        type = 0;
        window.location.href += `?type=${type}`
    }

    switch (type) {
        case "0":
            data = tqh1
            $("select.custom-select").val("0").change();
            break
        default:
            $("select.custom-select").val("1").change();
            data = tqh2
            break
    }

    $("select.custom-select").change(function () {
        var selectedCountry = $(this).children("option:selected").val();
        let url
        switch (selectedCountry) {
            case "0":
                url = window.location.href.replace(`type=${type}`, `type=0`)
                window.location.href = url
                break
            case "1":
                url = window.location.href.replace(`type=${type}`, `type=1`)
                window.location.href = url
                break
        }
    });

    map.on('load', function () {
        map.addSource('national-park', {
            'type': 'geojson',
            'data': data
        });

        map.addLayer({
            'id': 'park-boundary',
            'type': 'line',
            'source': 'national-park',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#035afc',
                'line-width': 8
            },
            'filter': ['==', '$type', 'LineString']
        });

        map.addSource('tqh-street', {
            'type': 'geojson',
            'data': tqh
        });

        map.addLayer({
            'id': 'tqh-street-1',
            'type': 'line',
            'source': 'tqh-street',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#0fffff',
                'line-width': 10
            },
            'filter': ['==', '$type', 'LineString']
        });

    });

    data.features.forEach(element => {
        if (element.properties.source == "OSM") {
            // make a marker for each feature and add to the map
            let marker = new wemapgl.Marker(marker_real.cloneNode(true))
                .setLngLat([element.properties.lon, element.properties.lat])
                .addTo(map);
            let viewPopup1 = document.createElement("div");
            viewPopup1.classList.add("viewPopup2");
            viewPopup1.innerHTML = element.properties.housenumber
            let markerElement1 = marker._element;
            markerElement1.appendChild(viewPopup1);

            let marker2 = new wemapgl.Marker(marker_proj.cloneNode(true))
                .setLngLat([element.properties.proj_lon, element.properties.proj_lat])
                .addTo(map);
            let viewPopup = document.createElement("div");
            viewPopup.classList.add("viewPopup2");
            viewPopup.innerHTML = element.properties.housenumber
            let markerElement = marker2._element;
            markerElement.appendChild(viewPopup);
        }
        if (element.properties.source == "VERTEX") {
            let vertex = new wemapgl.Marker()
                .setLngLat([element.properties.proj_lon, element.properties.proj_lat])
                .addTo(map);
            let viewPopup = document.createElement("div");
            viewPopup.classList.add("viewPopup2");
            viewPopup.innerHTML = element.properties.housenumber
            let markerElement = vertex._element;
            markerElement.appendChild(viewPopup);
        }
        // if (element.properties.type == "interpolated") {
        //     let interpolation_marker = new wemapgl.Marker(marker_interpolation.cloneNode(true))
        //         .setLngLat([element.properties.lon, element.properties.lat])
        //         .addTo(map)
        //     let viewPopup = document.createElement("div");
        //     viewPopup.classList.add("viewPopup2");
        //     viewPopup.innerHTML = element.properties.number
        //     let markerElement = interpolation_marker._element;
        //     markerElement.appendChild(viewPopup);
        // }
    })

    function getUrlVars() {
        var vars = [], hash;
        var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
        for (var i = 0; i < hashes.length; i++) {
            hash = hashes[i].split('=');
            vars.push(hash[0]);
            vars[hash[0]] = hash[1];
        }
        return vars;
    }
})