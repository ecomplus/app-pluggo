const logger = require('firebase-functions/logger')
const axios = require('axios')

const parsePluggoStatus = (status) => {
  switch (status) {
    case 'ready_to_ship':
    case 'pending':
      return 'ready_for_shipping'
    case 'collected':
    case 'received':
    case 'shipped':
      return 'shipped'
    case 'delivered':
      return 'delivered'
    case 'devolution':
      return 'returned'
  }
}

module.exports = async (
  { appSdk, storeId, auth },
  { order, token }
) => {
  const { number } = order
  logger.info(`Tracking #${storeId} ${number}`)
  const shippingLine = order.shipping_lines.find(({ flags }) => {
    return flags?.includes('logmanager')
  })
  const trackingId = shippingLine?.tracking_codes?.find(({ tag }) => tag === 'logmanager')
  if (!trackingId) {
    logger.warn(`Skipping ${order._id} with no tracking id`, { order, shippingLine })
    return
  }
  const { data } = await axios({
    method: 'get',
    url: `https://app.logmanager.com.br/api/integrations/erp/shipment/${trackingId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    timeout: 7000
  })
  const status = parsePluggoStatus(data?.order?.status)
  if (status === null) {
    logger.warn(`No parsed fulfillment status for #${storeId} ${number}`, {
      trackingId,
      data
    })
    return
  }
  if (status && status !== order.fulfillment_status?.current) {
    await appSdk.apiRequest(
      storeId,
      `/orders/${order._id}/fulfillments.json`,
      'POST',
      {
        shipping_line_id: shippingLine?._id,
        date_time: new Date().toISOString(),
        status,
        flags: ['logmanager']
      },
      auth
    )
    logger.info(`#${storeId} ${number} updated to ${status}`)
  }
}
