$(document).ready(function () {

    var type = getUrlVars()["type"]
    var data
    var street1
    var street2
    if (type == null) {
        type = 0;
        window.location.href += `?type=${type}`
    }

    switch (type) {
        case "0":
            data = data0;
            street1 = xuanthuy_street
            street2 = xuanthuy_street2
            $("select.custom-select").val("0").change();
            interpolation_data2.features.forEach(element => {
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
        case "2":
            data = xuanthuy_without_polygon;
            street1 = xuanthuy_street_2_line_1
            street2 = xuanthuy_street_2_line_2
            $("select.custom-select").val("2").change();

            break
        case "3":
            data = xuanthuy_with_polygon;
            street1 = xuanthuy_street
            street2 = xuanthuy_street2
            $("select.custom-select").val("3").change();
            // interpolation_data2.features.forEach(element => {
            //     if (element.properties.type == "interpolated") {
            //         let interpolation_marker = new wemapgl.Marker(marker_interpolation.cloneNode(true))
            //             .setLngLat([element.properties.lon, element.properties.lat])
            //             .addTo(map)
            //         let viewPopup = document.createElement("div");
            //         viewPopup.classList.add("viewPopup2");
            //         viewPopup.innerHTML = element.properties.number
            //         let markerElement = interpolation_marker._element;
            //         markerElement.appendChild(viewPopup);
            //     }
            // })
            break
        case "4":
            data = xuanthuy_with_polygon;
            street1 = xuanthuy_street_2_line_1
            street2 = xuanthuy_street_2_line_2
            $("select.custom-select").val("4").change();
            break
        case "5":
            $("select.custom-select").val("5").change();
            data = data1
            street1 = xuanthuy_street
            street2 = xuanthuy_street2
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
            street1 = xuanthuy_f1
            street2 = xuanthuy_f2
            break
        case "7":
            $("select.custom-select").val("7").change();
            data = data7
            street1 = xuanthuy_f1
            street2 = xuanthuy_f2
            break
        default:
            $("select.custom-select").val("1").change();
            data = xuanthuy_with_polygon
            street1 = xuanthuy_street
            street2 = xuanthuy_street2
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
            case "0":
                url = window.location.href.replace(`type=${type}`, `type=0`)
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
        // map.addSource('national-park', {
        //     'type': 'geojson',
        //     'data': data
        // });

        // map.addLayer({
        //     'id': 'park-boundary',
        //     'type': 'line',
        //     'source': 'national-park',
        //     'layout': {
        //         'line-join': 'round',
        //         'line-cap': 'round'
        //     },
        //     'paint': {
        //         'line-color': '#035afc',
        //         'line-width': 8
        //     },
        //     'filter': ['==', '$type', 'LineString']
        // });
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

    });

    if (type == 1 || type == 5 || type == 0) {
        data_test.forEach(element => {
            // make a marker for each feature and add to the map
            let marker = new wemapgl.Marker(marker_real.cloneNode(true))
                .setLngLat([element.real_lon, element.real_lat])
                .addTo(map);
            let viewPopup1 = document.createElement("div");
            viewPopup1.classList.add("viewPopup2");
            viewPopup1.innerHTML = element.housenumber
            let markerElement1 = marker._element;
            markerElement1.appendChild(viewPopup1);

        })
    }

    if (type == 2) {
        interpolation_without_polygon.features.forEach(element => {
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
    }
    if (type == 4) {
        interpolation_with_polygon.features.forEach(element => {
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
    }

    data.features.forEach(element => {
        if (element.properties.source == "OSM" && type != 2 && type != 4) {
            // make a marker for each feature and add to the map

            let marker2 = new wemapgl.Marker(marker_proj.cloneNode(true))
                .setLngLat([element.properties.lon, element.properties.lat])
                .addTo(map);
            let viewPopup = document.createElement("div");
            viewPopup.classList.add("viewPopup2");
            viewPopup.innerHTML = element.properties.housenumber
            let markerElement = marker2._element;
            markerElement.appendChild(viewPopup);

            // let marker = new wemapgl.Marker(marker_real.cloneNode(true))
            //     .setLngLat([element.properties.proj_lon_left, element.properties.proj_lat_left])
            //     .addTo(map);
            // let viewPopup1 = document.createElement("div");
            // viewPopup1.classList.add("viewPopup2");
            // viewPopup1.innerHTML = element.properties.housenumber
            // let markerElement1 = marker._element;
            // markerElement1.appendChild(viewPopup1);

            // let marker3 = new wemapgl.Marker(marker_real.cloneNode(true))
            //     .setLngLat([element.properties.proj_lon_right, element.properties.proj_lat_right])
            //     .addTo(map);
            // let viewPopup2 = document.createElement("div");
            // viewPopup2.classList.add("viewPopup2");
            // viewPopup2.innerHTML = element.properties.housenumber
            // let markerElement2 = marker3._element;
            // markerElement2.appendChild(viewPopup2);
        }


        // if (element.properties.source == "VERTEX") {
        //     let vertex = new wemapgl.Marker()
        //         .setLngLat([element.properties.proj_lon, element.properties.proj_lat])
        //         .addTo(map);
        //     let viewPopup = document.createElement("div");
        //     viewPopup.classList.add("viewPopup2");
        //     viewPopup.innerHTML = element.properties.housenumber
        //     let markerElement = vertex._element;
        //     markerElement.appendChild(viewPopup);
        // }

        // if (element.properties.source == "POLYGON") {
        //     let marker = new wemapgl.Marker(marker_real.cloneNode(true))
        //         .setLngLat([element.properties.proj_lon, element.properties.proj_lat])
        //         .addTo(map);
        //     let viewPopup1 = document.createElement("div");
        //     viewPopup1.classList.add("viewPopup2");
        //     viewPopup1.innerHTML = element.properties.housenumber
        //     let markerElement1 = marker._element;
        //     markerElement1.appendChild(viewPopup1);
        // }

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