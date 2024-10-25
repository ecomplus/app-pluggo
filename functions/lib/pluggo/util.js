const { logger } = require('firebase-functions')

const debugAxiosError = error => {
  const err = new Error(error.message)
  if (error.response) {
    err.status = error.response.status
    err.response = error.response.data
  }
  err.request = error.config
  logger.error(err)
  logger.warn(`${error.message} at ${error.config?.url}`, {
    data: error.config?.data,
    response: error.response?.data
  })
}

module.exports = {
  debugAxiosError
}
