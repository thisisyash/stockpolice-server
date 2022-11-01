const app = require('express')()
const bodyParser = require('body-parser')
const cors = require('cors');
var admin = require("firebase-admin");
var serviceAccount = require("./service_key.json");
const multer = require('multer')
const reader = require('xlsx')

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
  databaseURL: "https://stock-police.firebaseapp.com"
});
const firestore = admin.firestore();  
const messaging = admin.messaging()

app.listen(process.env.PORT || 3600, 
() => {
  console.log("Server started on port " + process.env.PORT)
})
app.use(bodyParser.json())
app.use(cors());
app.options('*', cors());

app.post('/uploadContacts', upload.single('file'), async (req, res) => {
  log("uploading contacts", req.file.path)
  const file = reader.readFile(req.file.path)
  const temp = reader.utils.sheet_to_json(file.Sheets[file.SheetNames[0]])
  const resp = await processUserData(temp)
  res.json({})
})

app.post('/subscribe', (req,res) => {
  const {tokenId} = req.body
  
  if (!tokenId) {
    log("Request to subscribe without token id")
    res.send({error : 'No token id'})
    return
  } else {
    log("Subscribing notifications for token : ", tokenId)
  }
  
  messaging.subscribeToTopic([tokenId], 'stockAlerts')
  .then((response) => {
    res.send({})
    log('Successfully subscribed to topic:',tokenId, response);
  })
  .catch((error) => {
    res.send(error)
    log('Error subscribing to topic:', tokenId, error);
  });
})

app.post('/unsubscribe', (req,res) => {
  const {tokenId} = req.body
  
  if (!tokenId) {
    log("Request to unsubscribe without token id")
    res.send({error : 'No token id'})
    return
  } else {
    log("UnSubscribing notifications for token : ", tokenId)
  }
  
  messaging.unsubscribeFromTopic([tokenId], 'stockAlerts')
  .then((response) => {
    res.send({})
    log('Successfully UNsubscribed to topic:',tokenId, response);
  })
  .catch((error) => {
    res.send(error)
    log('Error UNsubscribing to topic:', tokenId, error);
  });
})

app.post('/sendnotification', (req,res) => {
  const {title, body, description} = req.body
  
  if (!title || !body) {
    log("Sending notification without title or body")
    res.send({error : 'No title or body found'})
    return
  } else {
    log("Sending new notification: ", title, body)
  }
  
  const message = {
    notification: {
      title: title,
      body: body
    },
    data: {
      description : description
    },
    topic: 'stockAlerts'
  };

  messaging.send(message)
  .then((response) => {
    // Response is a message ID string.
    log('Successfully sent notification:', response);
    const notiData = {
      title: title,
      body: body,
      description : description,
      topic: 'stockAlerts',
      timeStamp : Date.now()
    }
    firestore.collection('alerts').doc().set(notiData)
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

const processUserData = async(userData) => {
  for(let res of userData) {
    const userResp = await checkUser(res.contact_number.toString())
    log(userResp)
  }
}

const checkUser = async(mobileNo) => {
  return new Promise((resolve, reject) => {
   firestore.collection('users').doc(mobileNo).get()
    .then(function async(docRef) {
      if (docRef.data()) {
        log(`User with mobile no ${mobileNo} already exists. Activating...`)
        firestore.collection('users').doc(mobileNo).update({
          isActive:true,
          isNotiEnabled:true
        })
        .then(function(docRef) {
          resolve('')
          log(`User with mobile no ${mobileNo} activated.`)
        })
        .catch(function(error) {
          reject('')
          log(`Failed to make ${mobileNo} active`, JSON.stringify(error))
        });
      } else {
        log(`User with mobile no ${mobileNo} does not exist. Creating new doc`)
        firestore.collection('users').doc(mobileNo).set({
          isActive : true,
          mobileNo : mobileNo,
          isNotiEnabled:true
        })
        .then(function(docRef) {
          log(`User with mobile no ${mobileNo} created successully`)
          resolve('')
        })
        .catch(function(error) {
          log(`Failed to make ${mobileNo} active`, JSON.stringify(error))
          reject('')
        });
      }
    })
    .catch(function(error) {
      reject('')
      log(`Failed to get ${mobileNo} document to check if it exist or not`, JSON.stringify(error));
    });  
  })
}

app.post('/createOrder', (req, res)=>{ 
  
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");

  const {mobileNos}  = req.body;  

  console.log(mobileNos)

  mobileNos.split(',').forEach(mobileNo => {
    log(mobileNo)
  });
  const mobileNo = '8181818181'

  // firestore.collection('users').doc(mobileNo).get()
  // .then(function(docRef) {
  //   if (docRef.data()) {
  //     log(`User with mobile no ${mobileNo} already exists. Activating...`)
  //     firestore.collection('users').doc(mobileNo).update({
  //       isActive:true
  //     })
  //     .then(function(docRef) {
  //       log(`User with mobile no ${mobileNo} activated.`)
  //     })
  //     .catch(function(error) {
  //       log(`Failed to make ${mobileNo} active`, JSON.stringify(error))
  //     });
  //   } else {
  //     log(`User with mobile no ${mobileNo} does not exist. Creating new doc`)
  //     firestore.collection('users').doc(mobileNo).set({
  //       isActive : true,
  //       mobileNo : mobileNo
  //     })
  //     .then(function(docRef) {
  //       log(`User with mobile no ${mobileNo} created successully`)
  //     })
  //     .catch(function(error) {
  //       log(`Failed to make ${mobileNo} active`, JSON.stringify(error))
  //     });
  //   }
  // })
  // .catch(function(error) {
  //   log(`Failed to get ${mobileNo} document to check if it exist or not`, JSON.stringify(error));
  // });  
})


const log = (label, value) => {
  if (value)
    console.log(label, value)
  else
    console.log(label)
}