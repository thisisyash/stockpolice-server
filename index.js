const app        = require('express')()
const bodyParser = require('body-parser')
const cors       = require('cors')
const multer     = require('multer')
const reader     = require('xlsx')
const fs         = require('fs')

var admin          = require("firebase-admin")

var serviceAccount = require(`./${process.env.NODE_ENV == 'production' ? 'prod':'test'}_service_key.json`)

require('dotenv').config({path: `.env.${process.env.NODE_ENV}`})

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'contactFiles/')
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname)
  },
})

const upload = multer({ storage: storage })

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DB_URL
})

const firestore = admin.firestore();  
const messaging = admin.messaging()
const port      = process.env.PORT || 3600

app.listen(port, 
() => {
  console.log(`Starting server in : ${process.env.NODE_ENV} on port : ${port}`)
})
app.use(bodyParser.json())
app.use(cors())
app.options('*', cors())

app.get('/', async(req, res) => {
  log("Welcome")
  res.send("Welcome")
})


app.post('/uploadContacts', upload.single('file'), async (req, res) => {
  log("uploading contacts", req.file.path)
  const file = reader.readFile(req.file.path)
  const temp = reader.utils.sheet_to_json(file.Sheets[file.SheetNames[0]])
  const resp = await processUserData(temp, req.body.groupId)
  res.json({})
})

app.post('/createNewuser', async(req,res) => {

  const {userData} = req.body
  log("Creating user with data", userData)
  const userResp = await createUser(userData.mobileNo, userData)
  res.send(userResp)
})

app.post('/subscribe', (req,res) => {

  const {tokenId, groups} = req.body
  
  if (!tokenId) {
    log("Request to subscribe without token id")
    res.send({error : 'No token id'})
    return
  } else {
    log("Subscribing notifications for token : ", tokenId)
  }
  
  groups.forEach((group, index) => {
    messaging.subscribeToTopic([tokenId], group)
    .then((response) => {
      log('Successfully subscribed to topic:',group);
      if (index == groups.length - 1) res.send({})
    })
    .catch((error) => {
      res.send(error)
      log('Error subscribing to topic:', group, error);
    });
  })

})

app.post('/unsubscribe', (req,res) => {

  const {tokenId, groups} = req.body
  
  if (!tokenId) {
    log("Request to unsubscribe without token id")
    res.send({error : 'No token id'})
    return
  } else {
    log("UnSubscribing notifications for token : ", tokenId)
  }

  groups.forEach((group, index) => {
    messaging.unsubscribeFromTopic([tokenId], group)
    .then((response) => {
      log('Successfully UNsubscribed to topic:', group);
      if (index == groups.length - 1) res.send({})
    })
    .catch((error) => {
      res.send(error)
      log('Error Unsubscribing to topic:', group, error);
    });
  })
})

app.post('/refreshNotifications', (req, res) => {

  const {topic} = req.body
  const message = {
    data  : {key : "REFRESH_NOTIFICATION"},
    topic : topic
  };

  messaging.send(message)
  .then((response) => {
    log('Refresh notification send successfully', response);
    res.send({})
  })
  .catch((error) => {
    res.send({error : 'Some error occured to send refresh notification'})
    log('Failed to send refresh notification : ', error);
  });
})

app.post('/sendnotification', (req,res) => {
  const {topic, body, uid} = req.body
  
  if (!body) {
    log("Sending notification without title or body")
    res.send({error : 'No title or body found'})
    return
  } else {
    log("Sending new notification: ", topic, body)
  }
  
  const message = {
    notification: {
      body:body
    },
    android: {
      priority : 'high',
      notification: {
        sound      : 'mysound',
        priority   : 'max',
        channelId  : 'stockalert',
        visibility : 'public'
      }
    },
    topic: topic
  };

  messaging.send(message)
  .then((response) => {
    log('Successfully sent notification:', response);
    const notiData = {
      body      : body,
      topic     : topic,
      uid       : uid,
      timeStamp : Date.now()
    }
    firestore.collection('alerts').doc(uid).set(notiData)
    .then(function(docRef) {
      log(`Notification set with data`, JSON.stringify(notiData))
      res.send({})
    })
    .catch(function(error) {
      log(`Failed to set notification in db`, JSON.stringify(error))
      res.send({error : error})
    });
  })
  .catch((error) => {
    res.send({error : 'Some error occured sending notifications'})
    log('Error sending notification:', error);
  });
})

const processUserData = async(userData, groupId) => {

  for(let res of userData) {
    let userProfile = {
      mobileNo   : res.contact_number.toString(),
      clientCode : res.client_code.toString(),
      userName   : res.name.toString(),
      groups     : [groupId]
    }
    const userResp = await createUser(res.contact_number.toString(), userProfile)
    log(userResp)
  }
}

const createUser = async(mobileNo, userProfile) => {

  log("Creating new user : ", mobileNo, JSON.stringify(userProfile))

  return new Promise((resolve, reject) => {
   firestore.collection('users').doc(mobileNo).get()
    .then(function async(docRef) {
      if (docRef.data()) {
        log(`User with mobile no ${mobileNo} already exists, merging groups...`)
        firestore.collection('users').doc(mobileNo).update({
          groups : admin.firestore.FieldValue.arrayUnion(userProfile.groups[0]),
          clientCode : userProfile.clientCode
        })
        .then(function(docRef) {
          resolve({})
          log(`User with mobile no ${mobileNo} merged.`)
        })
        .catch(function(error) {
          reject('')
          log(`Failed to merge ${mobileNo} groups`, JSON.stringify(error))
        });
        resolve({})
      } else {
        log(`User with mobile no ${mobileNo} does not exist. Creating new doc`)
        firestore.collection('users').doc(mobileNo).set({
          ...userProfile,
          isActive : true,
          isNotiEnabled:true
        })
        .then(function(docRef) {
          log(`User with mobile no ${mobileNo} created successully`)
          resolve({})
        })
        .catch(function(error) {
          log(`Failed to make ${mobileNo} active`, JSON.stringify(error))
          reject(error)
        });
      }
    })
    .catch(function(error) {
      reject(error)
      log(`Failed to get ${mobileNo} document to check if it exist or not`, JSON.stringify(error));
    });  
  })
}


const log = (label, value) => {
  const date     = new Date(),
        fileName = date.getDate() + - date.getMonth()
  let logData = label
  if (value) logData = label + "," + value
  logData = logData + "\n"
  fs.appendFileSync(`${fileName}-log.txt`, logData)
  if (value)
    console.log(label, value)
  else
    console.log(label)
}