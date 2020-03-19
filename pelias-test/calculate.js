$(document).ready(function () {

    var type = getUrlVars()["type"]
    var data
    var street1
    var street2
    if (type == null) {
        type = 1;
        window.location.href += `?type=${type}`
    }

    switch (type) {
        case "2":
            data = data2;
            street1 = xuanthuy_f1
            street2 = xuanthuy_f2
            $("select.custom-select").val("2").change();
            break
        case "3":
            $("select.custom-select").val("3").change();
            data = data3
            street1 = xuanthuy_f1
            street2 = xuanthuy_f2
            break
        case "4":
            $("select.custom-select").val("4").change();
            data = data4
            street1 = xuanthuy_f1
            street2 = xuanthuy_f2
            break
        case "5":
            $("select.custom-select").val("5").change();
            data = data1
            street1 = xuanthuy_s1
            street2 = xuanthuy_s2
            interpolation_data.features.forEach(element => {
                if (element.properties.type == "interpolated") {
                    let interpolation_marker = new wemapgl.Marker(marker_interpolation.cloneNode(true))
                        .setLngLat([element.properties.lon, element.properties.lat])
                        .addTo(map)
                    let viewPopup = document.createElement("div");
                    viewPopup.classList.add("viewPopup2");
                    viewPopup.innerHTML = element.properties.number
                    let markerElement = interpolation_marker._element;
                    markerElement.appendChild(viewPopup);
                }
            })
            break
        case "6":
            $("select.custom-select").val("6").change();
            data = data6
            street1 = xuanthuy_s1
            street2 = xuanthuy_s2
            break
        case "7":
            $("select.custom-select").val("7").change();
            data = data7
            street1 = xuanthuy_s1
            street2 = xuanthuy_s2
            break
        default:
            $("select.custom-select").val("1").change();
            data = data_44_22
            street1 = xuanthuy_s1
            street2 = xuanthuy_s2
            break
    }

    $("select.custom-select").change(function () {
        var selectedCountry = $(this).children("option:selected").val();
        let url
        switch (selectedCountry) {
            case "1":
                url = window.location.href.replace(`type=${type}`, `type=1`)
                window.location.href = url
                break
            case "2":
                url = window.location.href.replace(`type=${type}`, `type=2`)
                window.location.href = url
                break
            case "3":
                url = window.location.href.replace(`type=${type}`, `type=3`)
                window.location.href = url
                break
            case "5":
                url = window.location.href.replace(`type=${type}`, `type=5`)
                window.location.href = url
                break
            case "6":
                url = window.location.href.replace(`type=${type}`, `type=6`)
                window.location.href = url
                break
            case "7":
                url = window.location.href.replace(`type=${type}`, `type=7`)
                window.location.href = url
                break
            default:
                url = window.location.href.replace(`type=${type}`, `type=4`)
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
        map.addSource('national-park2', {
            'type': 'geojson',
            'data': street1
        });

        map.addLayer({
            'id': 'park-boundary2',
            'type': 'line',
            'source': 'national-park2',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#ff00ff',
                'line-width': 10
            },
            'filter': ['==', '$type', 'LineString']
        });
        map.addSource('national-park3', {
            'type': 'geojson',
            'data': street2
        });

        map.addLayer({
            'id': 'park-boundary3',
            'type': 'line',
            'source': 'national-park3',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#00ffff',
                'line-width': 10
            },
            'filter': ['==', '$type', 'LineString']
        });

        // map.addLayer({
        //     'id': 'park-volcanoes',
        //     'type': 'circle',
        //     'source': 'national-park',
        //     'paint': {
        //         'circle-radius': 8,
        //         'circle-color': '#B42222'
        //     },
        //     'filter': ['==', 'source', 'VERTEX']
        // });
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