$(document).ready(function () {
    const KEY = 'key=IqzJukzUWpWrcDHJeDpUPLSGndDx'
    var pass = 0
    var total = test_data.length
    var default_range = 35
    var range = default_range
    $('#nav').html(`Pass if deviation < a value default = ${range}m`)
    test_data.forEach(data => {
        if (data.deviation != null)
            range = Number(data.deviation)
        else
            range = default_range
        $.ajax({
            url: `https://apis.wemap.asia/geocode-1/search?text=${data.address}&boundary.country=VNM&${KEY}&focus.point.lat=21.037053680640796&focus.point.lon=105.77863286660659`,
            type: 'GET',
            dataType: 'json',
        }).done(function (ketqua) {
            var devia = Infinity
            var poi

            ketqua.features.forEach(features => {
                lat1 = features.geometry.coordinates[1]
                lon1 = features.geometry.coordinates[0]
                lat2 = Number(data.lat)
                lon2 = Number(data.lon)
                if (devia > distance(lat1, lon1, lat2, lon2)) {
                    devia = Math.round(distance(lat1, lon1, lat2, lon2) * 100) / 100
                    poi = features
                }
            });
            console.log(`
                    test_address:   ${data.address}
                    wemap_address:  ${poi != null ? poi.properties.housenumber
                    + ' ' + poi.properties.street : ''}
                    wemap:          ${lat1},${lon1}
                    test:           ${lat2},${lon2}
                    devia:          ${devia}
                `)
            add_to_table(data, devia,
                poi != null ? poi.properties.housenumber
                    + ' ' + poi.properties.street + ', '
                    + poi.properties.county : '',
                devia < range ? 'pass' : 'fail')
            if (devia < range) {
                pass += 1
                percent = Math.round(pass * 1000 / total) / 10
                console.log(percent)
                $('#percent').html(`WeMap pass ${pass}/${total} as ${percent}%`)
            }

        });
    });

})

function add_to_table(data, devia, address, isPass) {
    var row = `
            <tr>
                <td>${data.address}</td>
                <td>${data.lat}</td>
                <td>${data.lon}</td>
                <td>${data.note == null ? '' : data.note + (data.deviation == null ?
            '' : ', deviation < ' + data.deviation + 'm')}</td>
                <td>${devia}</td>
                <td>${address}</td>
                <td>${isPass}</td>
            </tr>
            `
    $('#result').append(row)
}

//:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
//:::                                                                         :::
//:::  This routine calculates the distance between two points (given the     :::
//:::  latitude/longitude of those points). It is being used to calculate     :::
//:::  the distance between two locations using GeoDataSource (TM) prodducts  :::
//:::                                                                         :::
//:::  Definitions:                                                           :::
//:::    South latitudes are negative, east longitudes are positive           :::
//:::                                                                         :::
//:::  Passed to function:                                                    :::
//:::    lat1, lon1 = Latitude and Longitude of point 1 (in decimal degrees)  :::
//:::    lat2, lon2 = Latitude and Longitude of point 2 (in decimal degrees)  :::
//:::    unit = the unit you desire for results                               :::
//:::           where: 'M' is statute metter (default)                         :::
//:::                  'K' is kilometers                                      :::
//:::                  'N' is nautical miles                                  :::
//:::                                                                         :::
//:::  Worldwide cities and other features databases with latitude longitude  :::
//:::  are available at https://www.geodatasource.com                         :::
//:::                                                                         :::
//:::  For enquiries, please contact sales@geodatasource.com                  :::
//:::                                                                         :::
//:::  Official Web site: https://www.geodatasource.com                       :::
//:::                                                                         :::
//:::               GeoDataSource.com (C) All Rights Reserved 2018            :::
//:::                                                                         :::
//:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

function distance(lat1, lon1, lat2, lon2, unit) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * lat1 / 180;
        var radlat2 = Math.PI * lat2 / 180;
        var theta = lon1 - lon2;
        var radtheta = Math.PI * theta / 180;
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180 / Math.PI;
        dist = dist * 60 * 1.1515;
        if (unit == "K") { dist = dist * 1.609344 }
        if (unit == "N") { dist = dist * 0.8684 }
        return dist * 1.609344 * 1000;
    }
}