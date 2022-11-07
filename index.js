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
      log('Successfully subscribed to topic:',group, response);
      if (index == groups.length - 1) res.send({})
    })
    .catch((error) => {
      res.send(error)
      log('Error subscribing to topic:', tokenId, error);
    });
  })

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
  const {topic, body} = req.body
  
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
    topic: topic
  };

  messaging.send(message)
  .then((response) => {
    // Response is a message ID string.
    log('Successfully sent notification:', response);
    const notiData = {
      body: body,
      topic: topic,
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

const processUserData = async(userData, groupId) => {
  for(let res of userData) {
    let userProfile = {
      mobileNo : res.contact_number.toString(),
      clientCode : res.client_code.toString(),
      userName : res.name.toString(),
      groups : [groupId]
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
          groups : admin.firestore.FieldValue.arrayUnion(userProfile.groups[0])
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