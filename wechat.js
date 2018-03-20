
const request = require('request');
const crypto = require('crypto');

const WechatConfig = require('../bin/wechat');

const OAuth = require('wechat-oauth');
const Client = new OAuth(WechatConfig.appid, WechatConfig.appsecret);

/*
 数据库实例化
 */
const dbConfig = require('../bin/db').config;
const accessTokenModel = dbConfig.import('../schema/access_token');
const userModel = dbConfig.import('../schema/users');
const logModel = dbConfig.import('../schema/log');

/*
  封装函数
 */

// 获取用户点击的URL
function getOAuthUrl() {
  return Client.getAuthorizeURL('http://yzsq.fensinet.com/games', 'yaozhaigame', 'snsapi_userinfo');
}

// 保存用户信息至数据库
function saveUserData(openid, Callback) {
  // 查询是否存在数据
  userModel.findOne({
    where: { openid: openid }
  }).then(function (callback) {

    console.log(callback);

    if ( callback === null ) {

      Client.getUser(openid, function (err, result) {

        if (err) { console.log(err); return; }

        // 创建数据
        userModel.create({
          openid: result.openid,
          name: result.nickname
        }).then(function (cb) {

          Log('success', '成功创建用户', result.openid)
          Callback('success')

        }).catch(function (err) {

          if (err) { Log('error', '创建用户失败', result.openid); }

        })
      });

    } else {

      Log('success', '成功登录用户', callback.openid)
      Callback('success')

    }

  }).catch(function (err) {
    console.log(err)
    if (err) { Log('error', '获取用户 OPENID 失败', openid); }
  });

}

// 获取 Access Token 和 jsapi_ticket
function getAccessToken(openid, Callback) {

  accessTokenModel.findOne({
    where: { id: 1 }
  }).then(function (DbCallback) {
    // 获取当前时间戳
    const timeStamp = Date.parse(new Date());
    // 判断是否过期
    if ( timeStamp - DbCallback.create_at > 7000 * 1000 ) {
      // 过期重新获取
      // 获取 Access Token
      request('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+ WechatConfig.appid +'&secret=' + WechatConfig.appsecret, function (error, response, body) {

        const access_token = JSON.parse(body).access_token;

        request('https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token='+ access_token +'&type=jsapi', function (error, response, body) {

          const jsapi_ticket = JSON.parse(body).ticket;

          // 更新数据库
          accessTokenModel.update({
            access_token: access_token,
            jsapi_ticket: jsapi_ticket,
            create_at: timeStamp
          },{
            where: { id: 1 }
          }).then(function (cb) {

            Log('success', 'Update Access Token / Jsapi Ticket', openid);
            Callback(access_token, jsapi_ticket);

          }).catch(function (err) {
            if (err) { Log('error', '更新 Access Token / Jsapi Ticket 失败', openid); next(); }
          });

        });
      });

    } else {
      Callback(DbCallback.access_token, DbCallback.jsapi_ticket);
    }
  }).catch(function (err) {
    if (err) { Log('error', '获取 Access Token 失败', openid); next(); }
  });

}

// 微信分享部分

//noncestr
function getShareNonceStr () {
  let text = "";
  let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for(let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
//timestamp
function getShareTimestamp() {
  return parseInt((new Date().valueOf())/1000);
}
// sha1
function getShareSha1(data) {
  const hash = crypto.createHash('sha1');
  hash.update(data);
  return hash.digest('hex');
}

/* ************************************************************* */

// Log
function Log(code, msg, openid) {
  const timeStamp = Date.parse(new Date());
  logModel.create({
    code: code,
    msg: msg,
    openid: openid ? openid : null,
    create_at: timeStamp
  })
}

/* ************************************************************* */

exports.hasCode = function (req, res, next) {

  // 判断路由是否有Code，有则中断后续函数
  if ( req.query.code ) {

    // 获取openid
    Client.getAccessToken( req.query.code, function (err, result) {

      if (err) { console.log(err); return; }

      const accessToken = result.data.access_token;
      const openid = result.data.openid;

      // 获取用户信息并存入数据库
      saveUserData(openid, function () {
        // 将用户信息写入客户端
        res.cookie('openid', openid, { maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.redirect('/games')
      });

    });

  } else {
    next();
  }

};

// 判断是否有Openid

exports.hasOpenId = function (req, res, next) {
  if ( !req.cookies.openid ) {
    res.redirect(getOAuthUrl());
  } else {
    console.log(req.cookies.openid);
    next()
  }
};

// 判断是否有关注公众号

exports.hasFollow = function (req, res, next) {

  getAccessToken(req.cookies.openid, function (access_token) {
    // 判断是否关注公众号
    request('https://api.weixin.qq.com/cgi-bin/user/info?access_token='+ access_token +'&openid='+ req.cookies.openid, function (error, response, body) {
      if ( JSON.parse(body).subscribe !== 1 ) {
        res.redirect('/games/unfollow');
      } else {
        next();
      }
    })
  })
};

// 微信分享签名
exports.getJsSdkSignature = function (req, res, next) {

  // 获取 access_token, jsapi_ticket
  getAccessToken(req.cookies.openid, function (access_token, jsapi_ticket) {
    // 开始签名
    const noncestr = getShareNonceStr();
    const timestamp = getShareTimestamp();
    const url = req.query.url;

    const string = 'jsapi_ticket=' + jsapi_ticket + '&noncestr=' + noncestr + '&timestamp=' + timestamp + '&url=' + url;

    const signature = getShareSha1(string);

    res.json({
      appId: WechatConfig.appid,
      timestamp: timestamp,
      nonceStr: noncestr,
      signature: signature
    })
  })
};
