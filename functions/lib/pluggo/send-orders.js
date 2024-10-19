const { firestore } = require('firebase-admin')
const { setup } = require('@ecomplus/application-sdk')
const logger = require('firebase-functions/logger')
const getAppData = require('../store-api/get-app-data')

const listStoreIds = () => {
  const storeIds = []
  const date = new Date()
  date.setHours(date.getHours() - 48)
  return firestore()
    .collection('ecomplus_app_auth')
    .where('updated_at', '>', firestore.Timestamp.fromDate(date))
    .get().then(querySnapshot => {
      querySnapshot.forEach(documentSnapshot => {
        const storeId = documentSnapshot.get('store_id')
        if (storeIds.indexOf(storeId) === -1) {
          storeIds.push(storeId)
        }
      })
      return storeIds
    })
}

const fetchOrdersToSend = async ({ appSdk, storeId }) => {
  const auth = await appSdk.getAuth(storeId)
  return new Promise((resolve, reject) => {
    getAppData({ appSdk, storeId, auth })
      .then(async (appData) => {
        resolve()
        const token = appData.logmanager_token
        let statusToSend = ''
        switch (appData.send_tag_status) {
          case 'Em produção':
            statusToSend = 'in_production'; break
          case 'Em separação':
            statusToSend = 'in_separation'; break
          case 'Pronto para envio':
            statusToSend = 'ready_for_shipping'; break
          case 'NF emitida':
            statusToSend = 'invoice_issued'; break
          case 'Enviado':
            statusToSend = 'shipped'; break
        }
        if (token && statusToSend) {
          const d1 = new Date()
          d1.setDate(d1.getDate() - 30)
          const d2 = new Date()
          d2.setHours(d2.getHours() - 2)
          const endpoint = '/orders.json' +
            '?fields=_id,number,fulfillment_status,shipping_lines' +
            '&shipping_lines.app.flags=logmanager' +
            '&financial_status.current=paid' +
            `&fulfillment_status.current=${statusToSend}` +
            `&updated_at>=${d1.toISOString()}` +
            `&updated_at<=${d2.toISOString()}` +
            '&sort=updated_at' +
            '&limit=200'
          try {
            const { response } = await appSdk.apiRequest(storeId, endpoint, 'GET')
            const orders = response.data.result
            for (let i = 0; i < orders.length; i++) {
              const order = orders[i]
              try {
                /*
                await exportOrder(
                  { appSdk, storeId, auth },
                  { order, token }
                )
                */
              } catch (error) {
                if (
                  error.response?.data?.error?.code === '404' ||
                  (error.response?.status > 403 && error.response.status <= 500)
                ) {
                  const err = new Error(`Failed exporting order ${order.number} for #${storeId}`)
                  logger.error(err, {
                    request: error.config,
                    response: error.response.data
                  })
                } else {
                  throw error
                }
              }
            }
          } catch (_err) {
            if (_err.response) {
              const err = new Error(`Failed exporting orders for #${storeId}`)
              logger.error(err, {
                request: _err.config,
                response: _err.response.data
              })
            } else {
              logger.error(_err)
            }
          }
        }
      })
      .catch(reject)
  })
}

module.exports = context => setup(null, true, firestore())
  .then(appSdk => {
    return listStoreIds().then(storeIds => {
      const runAllStores = fn => storeIds
        .sort(() => Math.random() - Math.random())
        .map(storeId => fn({ appSdk, storeId }))
      return Promise.all(runAllStores(fetchOrdersToSend))
    })
  })
  .catch(logger.error)
