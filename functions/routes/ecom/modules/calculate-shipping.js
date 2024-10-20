const defaultQuotes = require('../../../lib/pluggo/default-quotes')

exports.post = ({ appSdk }, req, res) => {
  /**
   * Treat `params` and (optionally) `application` from request body to properly mount the `response`.
   * JSON Schema reference for Calculate Shipping module objects:
   * `params`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/schema.json?store_id=100
   * `response`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/response_schema.json?store_id=100
   *
   * Examples in published apps:
   * https://github.com/ecomplus/app-mandabem/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-datafrete/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-jadlog/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   */

  const { params, application } = req.body
  // const { storeId } = req
  // setup basic required response object
  const response = {
    shipping_services: []
  }
  // merge all app options configured by merchant
  const appData = Object.assign({}, application.data, application.hidden_data)

  if (appData.free_shipping_from_value >= 0) {
    response.free_shipping_from_value = appData.free_shipping_from_value
  }
  if (!params.to) {
    // just a free shipping preview with no shipping address received
    // respond only with free shipping option
    res.send(response)
    return
  }
  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''

  let price
  if (appData.quotes) {
    for (let i = 0; i < appData.quotes.length; i++) {
      const row = appData.quotes[i]
      const zip = row.zip || row.CEP || row[0]
      if (!zip) continue
      if (`${zip}`.replace(/\D/g, '').padStart(8, '0') === destinationZip) {
        price = row.price || row.Valor || row[1]
        if (price) break
      }
    }
  }
  if (!price) {
    const quote = defaultQuotes.find(([zip]) => zip === destinationZip)
    if (quote) {
      price = quote[1]
    }
  }
  const discount = appData.additional_price ? -appData.additional_price : 0
  if (price) {
    response.shipping_services.push({
      label: appData.label || 'Super expresso',
      carrier: 'Pluggo',
      shipping_line: {
        from: {
          zip: appData.zip,
          ...params.from
        },
        to: params.to,
        price,
        total_price: price - discount,
        discount,
        delivery_time: {
          days: 0,
          working_days: true
        },
        posting_deadline: {
          days: 1,
          working_days: true,
          after_approval: true,
          ...appData.posting_deadline
        },
        flags: ['logmanager']
      }
    })
  }

  res.send(response)
}
