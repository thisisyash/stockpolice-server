const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file')
const moment = require('moment')
    
const consoleFormat = winston.format.combine(winston.format.colorize({ all : true }),
                      winston.format.splat(),
                      winston.format.prettyPrint(),
                      winston.format.printf(info => `${info.message}`))

const DATE_TIME_FORMAT = 'HH:mm:ss.SSS DD-MM-YYYY'
    
const logger = winston.createLogger({
    format     : winston.format.combine(
      winston.format.splat(),
      winston.format.prettyPrint(),
      winston.format.printf(info => `${info.message}`)
    ),
    level:'info',
    transports: [
        new winston.transports.Console({ format : winston.format.combine(winston.format.colorize(), consoleFormat) }),
        new DailyRotateFile({
          dirname     : 'logs',
          filename    : '%DATE%.log',
          datePattern : 'DD-MM-YYYY'
        })
    ]
});
    
function warn(msg, ...args) {
  msg = `[${moment().format(DATE_TIME_FORMAT)}] [WARNING] ` + msg + ' ' + JSON.stringify(args)
  logger.warn(msg, ...args)
}

function error(msg, ...args) {
  msg = `[${moment().format(DATE_TIME_FORMAT)}] [ERROR] ` + msg + ' ' + JSON.stringify(args)
  logger.error(msg, ...args)
}

function info(msg, ...args) {
  msg = `[${moment().format(DATE_TIME_FORMAT)}] [INFO] ` + msg + ' ' + JSON.stringify(args)
  logger.info(msg, ...args)
}
      
    
module.exports = {
    logger: logger,
    warn : warn,
    error : error,
    info : info
}