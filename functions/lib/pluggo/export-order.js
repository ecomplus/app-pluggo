const logger = require('firebase-functions/logger')
const axios = require('axios')
const { debugAxiosError } = require('./util')

module.exports = async (
  { appSdk, storeId, auth },
  { order, token }
) => {
  const { number } = order
  const shippingLine = order.shipping_lines.find(({ flags }) => {
    return flags?.includes('logmanager')
  })
  logger.info(`Start exporting order ${order._id}`, { order, shippingLine })
  if (!shippingLine.to) return
  const savedTrackingCode = shippingLine.tracking_codes?.find(({ tag }) => {
    return tag === 'logmanager'
  })
  if (savedTrackingCode) {
    logger.warn(`LogManager tracking already saved for #${storeId} ${number}`)
    return
  }
  logger.info(`Sending #${storeId} ${number}`)
  const buyer = order.buyers?.[0]
  const creationDate = new Date(order.created_at)
  const fmtDatePart = (n) => String(n).padStart(2, '0')
  const data = {
    idEnvio: order._id,
    codigointerno: `${number}`,
    dtCriacao: `${creationDate.getFullYear()}-` +
      `${fmtDatePart(creationDate.getMonth() + 1)}-` +
      `${fmtDatePart(creationDate.getDate())} ` +
      `${fmtDatePart(creationDate.getHours())}:` +
      `${fmtDatePart(creationDate.getMinutes())}:` +
      `${fmtDatePart(creationDate.getSeconds())}`,
    vlFrete: Math.round((order.amount.freight || 0) * 100),
    vlPago: Math.round(order.amount.total * 100),
    nomeComprador: shippingLine.to.name,
    enderecoEntrega: shippingLine.to.street,
    enderecoEntregaNumero: `${shippingLine.to.number || 'SN'}`,
    enderecoEntregaComplemento: shippingLine.to.complement || '',
    cepEntrega: shippingLine.to.zip.replace(/\D/g, ''),
    cidadeEntrega: shippingLine.to.city,
    estadoEntrega: shippingLine.to.province || shippingLine.to.province_code,
    bairroEntrega: shippingLine.to.borough,
    comentarios: shippingLine.to.near_to || '',
    idVenda: order._id,
    telefoneComprador: shippingLine.phone?.number || buyer?.phones?.[0].number,
    telefoneComprador_1: buyer?.phones?.[0].number,
    chaveNFE: `${order.number}`,
    numeroNFE: `${order.number}`,
    serieNFE: '1',
    itens: []
  }
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i]
    const productId = item.product_id
    if (!productId) continue
    const {
      response: { data: product }
    } = await appSdk.apiRequest(storeId, `/products/${productId}.json`, 'GET', null, null, true)
    const { weight, dimensions } = product
    if (!weight?.value || !dimensions) continue
    let gWeight = 0
    switch (weight.unit) {
      case 'kg':
        gWeight = weight.value * 1000
        break
      case 'mg':
        gWeight = weight.value / 1000
        break
      default:
        gWeight = weight.value
    }
    const cmDimensions = {}
    if (dimensions) {
      for (const side in dimensions) {
        const dimension = dimensions[side]
        if (dimension && dimension.value) {
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
    }
    data.itens.push({
      quantidade: item.quantity,
      descricao: product.name,
      dimensoes: {
        peso: gWeight,
        largura: cmDimensions.width,
        altura: cmDimensions.height,
        comprimento: cmDimensions.length
      }
    })
  }
  let response
  try {
    response = await axios({
      method: 'post',
      url: 'https://app.logmanager.com.br/api/integrations/erp/callback',
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      timeout: 7000
    })
  } catch (err) {
    debugAxiosError(err)
    return
  }
  if (response?.data?.success) {
    const trackingCodes = shippingLine.tracking_codes || []
    trackingCodes.push({
      code: response.data.ref_logmanager_id,
      link: response.data.tracking_url,
      tag: 'logmanager'
    })
    logger.info(`Updating #${storeId} ${number}`, { trackingCodes })
    return appSdk.apiRequest(
      storeId,
      `/orders/${order._id}/shipping_lines/${shippingLine._id}.json`,
      'PATCH',
      { tracking_codes: trackingCodes },
      auth
    )
  }
}
