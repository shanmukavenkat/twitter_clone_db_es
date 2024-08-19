const express = require('express')
const path = require('path')
const app = express()
app.use(express.json())
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDBServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('The server is running at http://localhost:3000')
    })
  } catch (e) {
    console.log(e.message)
    process.exit(1)
  }
}
initializeDBServer()

// Authentication Token Middleware
const authenticationToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'snvskomal', async (error, payload) => {
      if (error) {
        response.status(401) // Added status code for the response
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

// Register API
app.post('/register/', async (request, response) => {
  const {username, name, password, gender} = request.body

  // Check if the password is too short
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
    return
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT * 
                           FROM user  /* Fixed table name from tweet to user */
                           WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)

  if (dbUser === undefined) {
    const insertUserQuery = `INSERT INTO user (username, password, name, gender)
                             VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`
    await db.run(insertUserQuery)
    response.status(200)
    response.send('User created successfully')
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

///api -login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * 
     FROM user 
     WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username, user_id: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'snvskomal')
      response.send({jwtToken: jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// API to Get Latest Tweets of Followed Users
app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, response) => {
    const {username} = request // Extracting username from the request after authentication

    const selectUserQuery = `
      SELECT 
        t.tweet AS tweet, 
        u.username AS username, 
        t.date_time AS dateTime
      FROM 
        tweet t
      JOIN 
        follower f ON t.user_id = f.following_user_id
      JOIN 
        user u ON t.user_id = u.user_id
      WHERE 
        f.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}') /* Corrected WHERE clause */
      ORDER BY 
        t.date_time DESC
      LIMIT 4;
    `

    const tweetsFeed = await db.all(selectUserQuery)
    response.send(tweetsFeed)
  },
)
//API-4
app.get('/user/following/', authenticationToken, async (request, response) => {
  const {username} = request

  const selectFollowingQuery = `
      SELECT 
        u.name AS name
      FROM 
        follower f
      JOIN 
        user u ON f.following_user_id = u.user_id
      WHERE 
        f.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}');
    `

  const followingList = await db.all(selectFollowingQuery)
  response.send(followingList)
})

//API -5
app.get('/user/followers/', authenticationToken, async (request, response) => {
  const {username} = request

  // Retrieve user_id for the authenticated user
  const selectUserIdQuery = `
    SELECT user_id 
    FROM user 
    WHERE username = '${username}';
  `
  const user = await db.get(selectUserIdQuery)

  if (!user) {
    response.status(404).send('User not found')
    return
  }

  const userId = user.user_id

  // Retrieve names of followers
  const getFollowersUsersNamesQuery = `
    SELECT u.name
    FROM user u
    WHERE u.user_id IN (
      SELECT f.follower_user_id
      FROM follower f
      WHERE f.following_user_id = ${userId}
    );
  `

  const followersUsersArray = await db.all(getFollowersUsersNamesQuery)
  response.send(followersUsersArray)
})

///api-6 tweet
app.get('/tweets/:tweetId/', authenticationToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request

  // Get the user_id of the authenticated user
  const selectUserIdQuery = `
    SELECT user_id FROM user WHERE username = '${username}';
  `
  const user = await db.get(selectUserIdQuery)
  const userId = user.user_id

  // Check if the tweet belongs to a user that the current user follows
  const selectTweetQuery = `
    SELECT 
      t.tweet AS tweet,
      (SELECT COUNT(*) FROM like WHERE tweet_id = t.tweet_id) AS likes,
      (SELECT COUNT(*) FROM reply WHERE tweet_id = t.tweet_id) AS replies,
      t.date_time AS dateTime,
      f.follower_user_id
    FROM 
      tweet t
    JOIN 
      follower f ON t.user_id = f.following_user_id
    WHERE 
      t.tweet_id = ${tweetId} AND f.follower_user_id = ${userId};
  `

  const tweetDetails = await db.get(selectTweetQuery)

  if (tweetDetails === undefined) {
    // Scenario 1: Tweet does not belong to a user the current user follows
    response.status(401).send('Invalid Request')
  } else {
    // Scenario 2: Tweet belongs to a user the current user follows
    const {tweet, likes, replies, dateTime} = tweetDetails
    response.send({
      tweet,
      likes,
      replies,
      dateTime,
    })
  }
})

//api -7 likes
app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    // Get the user_id of the authenticated user
    const selectUserIdQuery = `
    SELECT user_id FROM user WHERE username = '${username}';
  `
    const user = await db.get(selectUserIdQuery)
    const userId = user.user_id

    // Check if the tweet belongs to a user that the current user follows
    const selectTweetQuery = `
    SELECT 
      t.tweet_id
    FROM 
      tweet t
    JOIN 
      follower f ON t.user_id = f.following_user_id
    WHERE 
      t.tweet_id = ${tweetId} AND f.follower_user_id = ${userId};
  `

    const tweetDetails = await db.get(selectTweetQuery)

    if (tweetDetails === undefined) {
      // Scenario 1: Tweet does not belong to a user the current user follows
      response.status(401).send('Invalid Request')
    } else {
      // Scenario 2: Tweet belongs to a user the current user follows
      const selectLikesQuery = `
      SELECT u.username 
      FROM like l
      JOIN user u ON l.user_id = u.user_id
      WHERE l.tweet_id = ${tweetId};
    `

      const likedUsers = await db.all(selectLikesQuery)
      const likes = likedUsers.map(user => user.username)

      response.send({likes})
    }
  },
)

///api-8
app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    // Get the user_id of the authenticated user
    const selectUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
    const user = await db.get(selectUserIdQuery)
    const userId = user.user_id

    // Check if the tweet belongs to a user that the current user follows
    const selectTweetQuery = `
    SELECT 1
    FROM tweet t
    JOIN follower f ON t.user_id = f.following_user_id
    WHERE t.tweet_id = ${tweetId} AND f.follower_user_id = ${userId};
  `

    const tweetExists = await db.get(selectTweetQuery)

    if (tweetExists === undefined) {
      // Scenario 1: Tweet does not belong to a user the current user follows
      response.status(401).send('Invalid Request')
    } else {
      // Scenario 2: Tweet belongs to a user the current user follows
      const getRepliesQuery = `
      SELECT user.name, reply.reply
      FROM reply
      JOIN user ON reply.user_id = user.user_id
      WHERE tweet_id = ${tweetId};
    `
      const replies = await db.all(getRepliesQuery)
      response.send({replies: replies})
    }
  },
)

///api-9
app.get('/user/tweets/', authenticationToken, async (request, response) => {
  let {username} = request
  const getUserIdQuery = `select user_id from user where username = '${username}';`
  const getUserId = await db.get(getUserIdQuery)

  const tweetsQuery = `
   select
   tweet,
   (select count(like_id)
    FROM like
    where tweet_id=tweet.tweet_id
   ) as likes,
   (select count(reply_id)
    from reply
    where tweet_id=tweet.tweet_id
   ) as replies,
   date_time as dateTime
   from tweet
   where user_id=${getUserId.user_id}
   ;`
  const tweetData = await db.all(tweetsQuery)
  response.send(tweetData)
})

///api-10

app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request
  const selectUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const user = await db.get(selectUserIdQuery)
  const userId = user.user_id

  const insertTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time)
    VALUES ('${tweet}', ${userId}, datetime('now'));
  `

  console.log('Executing query:', insertTweetQuery) // Debug log

  await db.run(insertTweetQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    // Get the user_id of the authenticated user
    const selectUserIdQuery = `
    SELECT user_id FROM user WHERE username = '${username}';
  `
    const user = await db.get(selectUserIdQuery)
    const userId = user.user_id

    // Check if the tweet exists and is owned by the user
    const selectTweetQuery = `
    SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};
  `
    const tweet = await db.get(selectTweetQuery)

    if (tweet === undefined) {
      response.status(404).send('Tweet not found')
      return
    }

    if (tweet.user_id !== userId) {
      // Scenario 1: The tweet does not belong to the user
      response.status(401).send('Invalid Request')
      return
    }

    // Scenario 2: The tweet belongs to the user, proceed with deletion
    const deleteTweetQuery = `
    DELETE FROM tweet WHERE tweet_id = ${tweetId};
  `

    await db.run(deleteTweetQuery)

    response.status(200).send('Tweet Removed')
  },
)

module.exports = app
