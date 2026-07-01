// 汽水音乐（com.luna.music）自动看广告领时长
// 流程：开屏广告 -> 底部"福利"tab -> "领时长" -> 等倒计时变"领取成功" -> 点击 -> 弹窗点"领取奖励" -> 循环
// "福利"是原生tab文字，能用accessibility识别；卡片里的"领时长/领取成功/领取奖励"按钮是自绘渐变按钮，
// accessibility树里没有文字，改用截图+OCR（paddle）找文字再按坐标点，跟qd.js里cappad()的思路一致。
// 需要 Autox.js v7 (https://github.com/aiselp/AutoX) 才有 paddle 识图。

var packageName = "com.luna.music";
var maxAds = 50; // ponytail: 没有观察到明确的每日上限提示，先给个够用的循环上限，出问题再调大
var adCount = 0;
var qs_scan_step = 20;       // 兜底扫描步长（像素）
var qs_collect_coord = {};   // 缓存"领取成功"点击坐标
var qsStorage = storages.create("ysun.QishuiMusic");
var qsCoordKey = "collectCoord";
(function() { var s = qsStorage.get(qsCoordKey); if (s) qs_collect_coord = JSON.parse(s); })();

auto.waitFor();
console.show();
console.setTitle("汽水音乐自动看广告");
if (auto.service == null) {
    console.error("请先开启无障碍服务！");
    exit();
}
if (!requestScreenCapture()) {
    console.error("请求截图权限失败");
    exit();
}
try {
    if (!paddle) throw new Error();
} catch (e) {
    console.error("无Paddle识图功能，请安装Autox.js v7！");
    exit();
}

try {
    launchApp();
    skipSplashAd();
    goToWelfare();
    watchAds();
    console.log("结束，共看" + adCount + "个广告");
} catch (e) {
    console.error("异常：" + e.message);
} finally {
    sleep(2000);
    console.hide();
}

function clickNode(node) {
    // ponytail: 文字节点常不可点击，逐级降级到坐标模拟真实触屏点击
    if (!node) return false;
    if (node.click()) return true;
    var p = node.parent();
    if (p && p.click()) return true;
    var b = node.bounds();
    click(parseInt((b.left + b.right) / 2), parseInt((b.top + b.bottom) / 2));
    return true;
}

function ocrFind(str) {
    var img = captureScreen();
    var res = paddle.ocr(img);
    sleep(100);
    for (var i = 0; i < res.length; i++) {
        if (res[i].text.indexOf(str) > -1) return res[i];
    }
    return null;
}

function ocrFindTop(str) {
    // 只在右上角区域查找（倒计时/领取成功在顶部右半侧）
    var img = captureScreen();
    var res = paddle.ocr(img);
    var maxY = device.height * 0.20;
    var minX = device.width * 0.40;
    sleep(100);
    for (var i = 0; i < res.length; i++) {
        if (res[i].text.indexOf(str) > -1) {
            var b = res[i].bounds;
            if ((b.top + b.bottom) / 2 < maxY && (b.left + b.right) / 2 > minX) return res[i];
        }
    }
    return null;
}

function ocrClick(str) {
    var r = ocrFind(str);
    if (!r) return false;
    var b = r.bounds;
    click(parseInt((b.left + b.right) / 2), parseInt((b.top + b.bottom) / 2));
    return true;
}

function waitOcrClick(str, maxSec) {
    for (var i = 0; i < maxSec; i++) {
        if (ocrClick(str)) return true;
        sleep(1000);
    }
    return false;
}

function scanClickCollect() {
    // 先试已记录坐标
    var keys = Object.keys(qs_collect_coord);
    for (var ki = 0; ki < keys.length; ki++) {
        var c = qs_collect_coord[keys[ki]];
        click(c.x, c.y);
        sleep(800);
        if (ocrFind("领取奖励")) {
            console.verbose("已知坐标命中：" + c.x + "," + c.y);
            return true;
        }
    }
    // 扫描右上角区域（领取成功按钮所在位置）
    var xRight  = parseInt(device.width * 0.98);
    var xLeft   = parseInt(device.width * 0.55);
    var yTop    = parseInt(device.height * 0.02);
    var yBottom = parseInt(device.height * 0.10);
    for (var sx = xRight; sx >= xLeft; sx -= qs_scan_step) {
        for (var sy = yTop; sy <= yBottom; sy += qs_scan_step) {
            console.verbose("扫描：" + sx + "," + sy);
            click(sx, sy);
            sleep(800);
            if (ocrFind("领取奖励")) {
                var key = sx + "," + sy;
                var newCoord = {};
                newCoord[key] = { x: sx, y: sy };
                var oldKeys = Object.keys(qs_collect_coord);
                for (var oi = 0; oi < oldKeys.length && Object.keys(newCoord).length < 3; oi++) {
                    if (oldKeys[oi] !== key) newCoord[oldKeys[oi]] = qs_collect_coord[oldKeys[oi]];
                }
                qs_collect_coord = newCoord;
                qsStorage.put(qsCoordKey, JSON.stringify(qs_collect_coord));
                console.log("记录领取成功坐标：" + sx + "," + sy);
                return true;
            }
        }
    }
    return false;
}

function launchApp() {
    if (currentPackage() != packageName) {
        home();
        sleep(500);
        launch(packageName);
        sleep(1500);
    }
}

function skipSplashAd() {
    // 开屏广告固定持续6秒，多等一点再确认
    console.log("等待开屏广告");
    sleep(7000);
    if (textContains("跳过").exists()) clickNode(textContains("跳过").findOne(500));
}

function goToWelfare() {
    var btn = text("福利").findOne(10000);
    if (!btn) {
        console.error('未找到底部"福利"tab，当前activity：' + currentActivity());
        exit();
    }
    console.log('找到"福利"tab，点击');
    clickNode(btn);
    sleep(2000);

    for (var i = 0; i < 8 && !ocrFind("领时长"); i++) {
        console.verbose("等待福利页加载……");
        sleep(1000);
    }
}

function watchAds() {
    // 只需点一次"领时长"，后续每轮领取后自动开启下一个倒计时
    var started = waitOcrClick("领时长", 5) || waitOcrClick("立即解锁", 5);
    if (!started) {
        console.log('未找到"领时长"或"立即解锁"，无可看广告');
        return;
    }
    console.log('已点击广告入口');
    sleep(2000);

    while (adCount < maxAds) {
        // 等屏幕底部出现"领取成功"按钮（排除广告内容的误识别）
        var done = false;
        for (var i = 0; i < 200 && !done; i++) {
            var r = ocrFindTop("领取成功");
            if (r) {
                var b = r.bounds;
                click(parseInt((b.left + b.right) / 2), parseInt((b.top + b.bottom) / 2));
                done = true;
            } else if (textContains("继续观看").exists()) {
                console.verbose("广告中断弹窗，点继续观看");
                textContains("继续观看").findOne(500).click();
                sleep(1000);
            } else {
                sleep(1000);
                if (i == 40) {
                    // 兜底：40秒后OCR未识别，扫描右上角区域找领取成功按钮
                    console.verbose("OCR未识别到领取成功，启动扫描兜底");
                    if (scanClickCollect()) done = true;
                }
            }
        }
        if (!done) { console.warn("等待广告完成超时"); break; }
        console.verbose('已点击"领取成功"');
        sleep(1000);

        if (!waitOcrClick("领取奖励", 5)) {
            console.log('未找到"领取奖励"，可能已无更多广告');
            break;
        }
        adCount++;
        console.log("已领取第" + adCount + "个广告奖励");
        sleep(2000);
        // 等右上角"领取成功"消失，避免捡到上轮残留
        for (var j = 0; j < 20 && ocrFindTop("领取成功"); j++) {
            sleep(500);
        }
    }
}
