const app        = require('express')()
const bodyParser = require('body-parser')
const cors       = require('cors')
const multer     = require('multer')
const reader     = require('xlsx')
const fs         = require('fs')
const { Storage } = require('@google-cloud/storage')
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

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for video uploads
  }
})

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
app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))

const allowedOrigins = [
  'https://stockpolice.trade/',
  'https://stockpolice.app/'
];

app.use(cors());
// This line ensures preflight requests are handled
app.options('*', cors());

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

app.post('/appVersionCheck', (req, res) => {

  console.log("App Version Check")
  
  const {appVersion} = req.body

  console.log("Current app version : ", appVersion)

    if (appVersion == '1.1.0') {
      res.json({
        "action" : "UPDATE",
        "version" : "2.0.0",
        "url" : "https://firebasestorage.googleapis.com/v0/b/test-stockpolice.appspot.com/o/build_files%2Fbuild_test_2.0.0.zip?alt=media&token=4782884c-b2fe-47e3-9e2c-040b389449e3"
      })
    } else {
      res.json({
        action : "IGNORE"
      })
    }
})

app.post('/sendnotification', (req,res) => {
  const {topic, body, uid, fileType, fileLink,newBody } = req.body
  
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
      timeStamp : Date.now(),
      newBody   : newBody  || null,
      fileType  : fileType || null,
      fileLink  : fileLink || null
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

      let userDeviceToken = null

      if (docRef.data()) {

        log(`User with mobile no ${mobileNo} already exists, merging groups...`)

        userDeviceToken = docRef.data().deviceToken
        firestore.collection('users').doc(mobileNo).update({
          groups : admin.firestore.FieldValue.arrayUnion(userProfile.groups[0]),
          clientCode : userProfile.clientCode
        })
        .then(function(docRef) {
          messaging.subscribeToTopic([userDeviceToken], userProfile.groups[0])
          .then((response) => {
            log('Successfully subscribed to topic:',userDeviceToken, userProfile.groups[0])
          })
          .catch((error) => {
            // res.send(error)
            log('Error subscribing to topic:', userDeviceToken, group, error)
          })

          resolve({})
          log(`User with mobile no ${mobileNo} merged.`)
        })
        .catch(function(error) {

          console.log("============", error)

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


app.post('/sendStatus', (req,res) => { 

    const {topic, body, uid, fileLink} = req.body 

    const notiData = { 
      body      : body, 
      topic     : topic, 
      uid       : uid, 
      fileLink  : fileLink, 
      timeStamp : Date.now() 
    } 
    
   
    firestore.collection('status').doc(uid).set(notiData)
    .then(function(docRef) { 
      log(`Status set with data`, JSON.stringify(notiData)) 


      //Send notification start
      const message = {
        notification: {
          body:'New status updated'
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
        topic : 'jJkgYrvYRjWAYj1kEJDw'
      }
      messaging.send(message)
      .then((response) => {
        log('Successfully sent notification:', response)
      })
      .catch((error) => {
        res.send({error : 'Some error occured sending notifications'})
        log('Error sending notification:', error)
      })
      //Send notification end



      res.send({}) 
    }).catch(function(error) { 
      log(`Failed to set Status in db`, JSON.stringify(error)) 
      res.send({error : error}) 
    })
})


// New API endpoint to fetch video URLs
app.get('/api/videos', async (req, res) => {
  try {
    // Query the 'videos' collection in Firestore
    const videosSnapshot = await firestore.collection('spVideos').get();

    // Extract video data from the snapshot
    const videos = [];
    videosSnapshot.forEach((doc) => {
      videos.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Send the videos as a JSON response
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).send({ error: 'Failed to fetch videos' });
  }
});

app.post('/uploadVideoData', async (req, res) => {
  try {
    const { videoTitle, videoDescription, videoTags, videoCategory, videoType, videoUrl } = req.body;

    const videoData = {
      title: videoTitle,
      description: videoDescription,
      tags: videoTags,
      category: videoCategory,
      type: videoType,
      url: videoUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await firestore.collection('spVideos').add(videoData);
    console.log('Video data uploaded successfully:', docRef.id);
    res.status(200).send({ id: docRef.id });
  } catch (error) {
    console.error('Error uploading video data:', error);
    res.status(500).send({ error: 'Failed to upload video data' });
  }
});

// API endpoint to upload banner video data to Firestore
app.post('/api/bannerVideos', async (req, res) => {
  try {
    const { videoTitle, videoDescription, videoUrl, thumbnailUrl } = req.body;

    const videoData = {
      title: videoTitle,
      description: videoDescription,
      url: videoUrl,
      thumbnailUrl: thumbnailUrl || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await firestore.collection('bannerVideos').add(videoData);
    console.log('Banner video data uploaded successfully:', docRef.id);
    res.status(200).send({ id: docRef.id });
  } catch (error) {
    console.error('Error uploading banner video data:', error);
    res.status(500).send({ error: 'Failed to upload banner video data' });
  }
});

// API endpoint to fetch banner videos
app.get('/api/bannerVideos', async (req, res) => {
  try {
    // Query the 'bannerVideos' collection in Firestore
    const videosSnapshot = await firestore.collection('bannerVideos').orderBy('timestamp', 'desc').get();

    // Extract video data from the snapshot
    const videos = [];
    videosSnapshot.forEach((doc) => {
      videos.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Send the videos as a JSON response
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error fetching banner videos:', error);
    res.status(500).send({ error: 'Failed to fetch banner videos' });
  }
});

// API endpoint to delete banner video
app.delete('/api/bannerVideos/:id', async (req, res) => {
  try {
    const videoId = req.params.id;
    
    // Delete the video document from Firestore
    await firestore.collection('bannerVideos').doc(videoId).delete();
    
    console.log('Banner video deleted successfully:', videoId);
    res.status(200).send({ message: 'Banner video deleted successfully' });
  } catch (error) {
    console.error('Error deleting banner video:', error);
    res.status(500).send({ error: 'Failed to delete banner video' });
  }
});

app.post('/api/videos/:id/like', async (req, res) => {
  const videoId = req.params.id;
  try {
    const videoRef = firestore.collection('spVideos').doc(videoId);
    await firestore.runTransaction(async (transaction) => {
      const videoDoc = await transaction.get(videoRef);
      if (!videoDoc.exists) {
        throw new Error('Video not found');
      }
      const newLikeCount = (videoDoc.data().likes || 0) + 1;
      transaction.update(videoRef, { likes: newLikeCount });
    });
    res.status(200).send({ message: 'Like count updated successfully' });
  } catch (error) {
    console.error('Error updating like count:', error);
    res.status(500).send({ error: 'Failed to update like count' });
  }
});

app.post('/api/videos/:id/comment', async (req, res) => {
  const videoId = req.params.id;
  const { comment } = req.body;

  try {
    const videoRef = firestore.collection('spVideos').doc(videoId);
    await firestore.runTransaction(async (transaction) => {
      const videoDoc = await transaction.get(videoRef);
      if (!videoDoc.exists) {
        throw new Error('Video not found');
      }
      const comments = videoDoc.data().comments || [];
      comments.push(comment);
      transaction.update(videoRef, { comments });
    });
    res.status(200).send({ message: 'Comment added successfully' });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).send({ error: 'Failed to add comment' });
  }
});

// Initialize Google Cloud Storage
const fbStorage = new Storage({
  projectId: process.env.GCLOUD_PROJECT_ID,
  keyFilename: `./${process.env.NODE_ENV == 'production' ? 'prod':'test'}_service_key.json`
});

const bucketName = process.env.BUCKET_NAME;

// API endpoint to upload video file
app.post('/api/uploadVideo', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const destination = `spvideos/${req.file.originalname}`;

    // Upload file to Firebase Storage
    await fbStorage.bucket(bucketName).upload(filePath, {
      destination,
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Get the public URL of the uploaded file
    const file = fbStorage.bucket(bucketName).file(destination);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    // Clean up the temporary file
    fs.unlinkSync(filePath);
    console.log('Temporary video file cleaned up:', filePath);

    res.status(200).send({ url });
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).send({ error: 'Failed to upload video' });
  }
});

// API endpoint to upload banner video file
app.post('/api/uploadBannerVideo', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const destination = `bannervideos/${req.file.originalname}`;

    // Upload file to Firebase Storage
    await fbStorage.bucket(bucketName).upload(filePath, {
      destination,
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Get the public URL of the uploaded file
    const file = fbStorage.bucket(bucketName).file(destination);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    // Clean up the temporary file
    fs.unlinkSync(filePath);
    console.log('Temporary banner video file cleaned up:', filePath);

    res.status(200).send({ url });
  } catch (error) {
    console.error('Error uploading banner video:', error);
    res.status(500).send({ error: 'Failed to upload banner video' });
  }
});

// API endpoint to upload banner thumbnail file
app.post('/api/uploadBannerThumbnail', upload.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const destination = `bannerthumbnails/${req.file.originalname}`;

    // Upload file to Firebase Storage
    await fbStorage.bucket(bucketName).upload(filePath, {
      destination,
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Get the public URL of the uploaded file
    const file = fbStorage.bucket(bucketName).file(destination);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    // Clean up the temporary file
    fs.unlinkSync(filePath);
    console.log('Temporary banner thumbnail file cleaned up:', filePath);

    res.status(200).send({ url });
  } catch (error) {
    console.error('Error uploading banner thumbnail:', error);
    res.status(500).send({ error: 'Failed to upload banner thumbnail' });
  }
});

app.post('/api/videos/:id/markStar', async (req, res) => {
  const videoId = req.params.id;
  const { isStar } = req.body;

  try {
    const videoRef = firestore.collection('spVideos').doc(videoId);
    await firestore.runTransaction(async (transaction) => {
      const videoDoc = await transaction.get(videoRef);
      if (!videoDoc.exists) {
        throw new Error('Video not found');
      }
      transaction.update(videoRef, { type : isStar ? "Star Video" : "Normal" });
    });
    res.status(200).send({ message: 'Star status updated successfully' });
  } catch (error) {
    console.error('Error updating star status:', error);
    res.status(500).send({ error: 'Failed to update star status' });
  }
});

// API to notify all admin users when a new user registers
app.post('/notifyAdminsOnRegister', async (req, res) => {
  try {
    const { username } = req.body;
    // Query all users with isAdmin == true
    const adminSnapshot = await firestore.collection('users').where('isAdmin', '==', true).get();
    if (adminSnapshot.empty) {
      return res.status(404).send({ error: 'No admin users found' });
    }
    const notificationPromises = [];
    adminSnapshot.forEach((doc) => {
      const adminData = doc.data();
      const deviceToken = adminData.deviceToken;
      if (deviceToken) {
        // Prepare notification payload
        const notificationPayload = {
          body: `New user ${username ? username : ''} has registered on StockPolice.`,
          uid: deviceToken,
        };
        // Use the same notification logic as /sendnotification
        notificationPromises.push(
          messaging.send({
            notification: { body: notificationPayload.body },
            token: deviceToken,
            android: {
              priority: 'high',
              notification: {
                sound: 'mysound',
                priority: 'max',
                channelId: 'stockalert',
                visibility: 'public',
              },
            },
          })
          .then((response) => {
            log('Successfully sent admin notification:', deviceToken, response);
            // Optionally, log to Firestore alerts collection
          })
          .catch((error) => {
            log('Error sending admin notification:', deviceToken, error);
            return null;
          })
        );
      }
    });
    await Promise.all(notificationPromises);
    res.send({ message: 'Notifications sent to all admin users.' });
  } catch (error) {
    console.error('Error notifying admin users:', error);
    res.status(500).send({ error: 'Failed to notify admin users.' });
  }
});

// API to send chat message notification
app.post('/api/sendChatNotification', async (req, res) => {
  try {
    const { receiverMobileNumber, senderName, message, isAdminSender } = req.body;
    
    log('=== CHAT NOTIFICATION REQUEST ===');
    log('Receiver Mobile:', receiverMobileNumber);
    log('Sender Name:', senderName);
    log('Message:', message);
    log('Is Admin Sender:', isAdminSender);
    
    if (!receiverMobileNumber || !message) {
      log('ERROR: Missing required fields - receiverMobileNumber:', receiverMobileNumber, 'message:', message);
      return res.status(400).send({ error: 'Missing required fields' });
    }

    // Get receiver's device token
    log('Fetching receiver document for:', receiverMobileNumber);
    const receiverDoc = await firestore.collection('users').doc(receiverMobileNumber).get();
    
    if (!receiverDoc.exists) {
      log('ERROR: Receiver not found in database:', receiverMobileNumber);
      return res.status(404).send({ error: 'Receiver not found' });
    }

    const receiverData = receiverDoc.data();
    const deviceToken = receiverData.deviceToken;
    
    log('Receiver data found:', {
      userName: receiverData.userName,
      hasDeviceToken: !!deviceToken,
      deviceTokenLength: deviceToken ? deviceToken.length : 0
    });

    if (!deviceToken) {
      log('WARNING: No device token found for receiver:', receiverMobileNumber);
      return res.status(200).send({ message: 'No device token available for receiver' });
    }

    // Prepare notification message (WhatsApp style)
    const senderDisplayName = isAdminSender ? 'Admin' : (senderName || 'User');
    
    log('Preparing notification payload:', {
      title: senderDisplayName,
      body: message,
      token: deviceToken.substring(0, 20) + '...' // Log only first 20 chars for security
    });

    // Send push notification
    const messagePayload = {
      notification: {
        title: senderDisplayName,
        body: message
      },
      token: deviceToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'mysound',
          priority: 'max',
          channelId: 'stockalert',
          visibility: 'public'
        }
      }
    };

    log('Sending push notification...');
    const response = await messaging.send(messagePayload);
    log('SUCCESS: Chat notification sent successfully:', {
      messageId: response,
      receiver: receiverMobileNumber,
      sender: senderDisplayName
    });
    
    res.status(200).send({ message: 'Chat notification sent successfully' });
  } catch (error) {
    log('ERROR: Failed to send chat notification:', {
      error: error.message,
      stack: error.stack,
      receiver: req.body.receiverMobileNumber,
      sender: req.body.senderName
    });
    console.error('Error sending chat notification:', error);
    res.status(500).send({ error: 'Failed to send chat notification' });
  }
});