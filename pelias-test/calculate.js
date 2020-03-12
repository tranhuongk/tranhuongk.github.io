$(document).ready(function () {
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

        map.addLayer({
            'id': 'park-volcanoes',
            'type': 'circle',
            'source': 'national-park',
            'paint': {
                'circle-radius': 8,
                'circle-color': '#B42222'
            },
            'filter': ['==', '$type', 'Point']
        });
    });

    data.features.forEach(element => {
        if (element.properties.source == "OSM") {
            // make a marker for each feature and add to the map
            new wemapgl.Marker(marker.cloneNode(true))
                .setLngLat([element.properties.lon, element.properties.lat])
                .addTo(map);

            new wemapgl.Marker(marker_proj.cloneNode(true))
                .setLngLat([element.properties.proj_lon, element.properties.proj_lat])
                .addTo(map);

        }
    })
})