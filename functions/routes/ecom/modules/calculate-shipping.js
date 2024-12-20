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
  if (!params.to) {
    // skip free shipping option without destination zip (few zip codes served)
    res.send(response)
    return
  }

  const appData = Object.assign({}, application.data, application.hidden_data)
  let pkgKgWeight = 0
  let subtotal = 0
  params.items?.forEach((item) => {
    const { quantity, dimensions, weight } = item
    let kgWeight = 0
    let cubicWeight = 0
    if (weight && weight.value) {
      switch (weight.unit) {
        case 'g':
          kgWeight = weight.value / 1000
          break
        case 'mg':
          kgWeight = weight.value / 1000000
          break
        default:
          kgWeight = weight.value
      }
    }
    const cmDimensions = {
      height: 5,
      width: 10,
      length: 10
    }
    if (dimensions) {
      for (const side in dimensions) {
        const dimension = dimensions[side]
        if (dimension?.value) {
          switch (dimension.unit) {
            case 'm':
              cmDimensions[side] = dimension.value * 100
              break
            case 'mm':
              cmDimensions[side] = dimension.value / 10
              break
            default:
              cmDimensions[side] = dimension.value
          }
        }
      }
      let m3 = 1
      for (const side in cmDimensions) {
        if (cmDimensions[side] > 60) {
          res.send(response)
          return
        }
        if (cmDimensions[side]) {
          m3 *= (cmDimensions[side] / 100)
        }
      }
      if (m3 !== 1) {
        // 167 kg/m³
        cubicWeight = m3 * 167
      }
    }
    if (kgWeight > 0) {
      const unitFinalWeight = cubicWeight < 0.5 || kgWeight > cubicWeight
        ? kgWeight
        : cubicWeight
      pkgKgWeight += (quantity * unitFinalWeight)
    }
    subtotal += quantity * (item.final_price || item.price)
  })
  if (pkgKgWeight) {
    const maxKg = appData.max_weight || 5
    if (pkgKgWeight > maxKg) {
      res.send(response)
      return
    }
  }

  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
  const checkZipCode = rule => {
    if (destinationZip && rule.zip_range) {
      const { min, max } = rule.zip_range
      return Boolean((!min || destinationZip >= min) && (!max || destinationZip <= max))
    }
    return true
  }

  let price
  if (appData.quotes?.length) {
    for (let i = 0; i < appData.quotes.length; i++) {
      const row = appData.quotes[i]
      const zip = row.zip || row.CEP || row[0]
      if (!zip) continue
      if (`${zip}`.replace(/\D/g, '').padStart(8, '0') === destinationZip) {
        price = row.price || row.Valor || row[1]
        if (price) break
      }
    }
  } else {
    const quote = defaultQuotes.find(([zip]) => zip === destinationZip)
    if (quote) {
      price = quote[1]
    }
  }
  const discount = appData.additional_price ? -appData.additional_price : 0
  if (price) {
    const shippingLine = {
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
    if (Array.isArray(appData.shipping_rules)) {
      for (let i = 0; i < appData.shipping_rules.length; i++) {
        const rule = appData.shipping_rules[i]
        if (rule && checkZipCode(rule) && !(rule.min_amount > subtotal)) {
          if (rule.free_shipping) {
            shippingLine.discount += shippingLine.total_price
            shippingLine.total_price = 0
            break
          } else if (rule.discount) {
            let discountValue = rule.discount.value
            if (rule.discount.percentage) {
              discountValue *= (shippingLine.total_price / 100)
            }
            if (discountValue) {
              shippingLine.discount += discountValue
              shippingLine.total_price -= discountValue
              if (shippingLine.total_price < 0) {
                shippingLine.total_price = 0
              }
            }
            break
          }
        }
      }
    }
    response.shipping_services.push({
      label: appData.label || 'Super expresso',
      carrier: 'Pluggo',
      shipping_line: shippingLine
    })
    if (appData.free_shipping_from_value >= 0) {
      response.free_shipping_from_value = appData.free_shipping_from_value
    }
    if (Array.isArray(appData.shipping_rules)) {
      for (let i = 0; i < appData.shipping_rules.length; i++) {
        const rule = appData.shipping_rules[i]
        if (rule.free_shipping && checkZipCode(rule)) {
          if (!rule.min_amount) {
            response.free_shipping_from_value = 0
            break
          } else if (!(response.free_shipping_from_value <= rule.min_amount)) {
            response.free_shipping_from_value = rule.min_amount
          }
        }
      }
    }
  }

  res.send(response)
}
