# MameCompress Vision

顔・注目領域・手動で囲った部分を保護し、背景を強めに圧縮するブラウザ完結型の画像圧縮MVPです。

## 特徴

- 画像はサーバーへアップロードされません。
- HTML / CSS / JavaScript だけで動きます。
- GitHub Pages などの静的ホスティングで公開できます。
- `FaceDetector` 対応ブラウザではJS顔検出を使用します。
- 非対応ブラウザでも、手動ROI指定と簡易注目領域推定で動きます。
- 出力形式は WebP / JPEG / PNG を選べます。

## ファイル構成

```text
mamecompress-vision/
  index.html
  css/
    style.css
  js/
    app.js
  .nojekyll
  README.md
```

## GitHub Pagesで公開する方法

1. GitHubで新しいリポジトリを作成します。
2. このフォルダの中身をリポジトリ直下にアップロードします。
3. リポジトリの Settings → Pages を開きます。
4. Source を Deploy from a branch にします。
5. Branch を `main`、Folder を `/root` にします。
6. 表示されたURLにアクセスします。

## 注意

- PHP、DB、Node.js、サーバー側画像処理は不要です。
- `.htaccess` はGitHub Pagesでは使わないため同梱していません。
- 顔検出はブラウザの対応状況に依存します。非対応でも手動指定で利用できます。
- 画像処理は端末のブラウザ内で行うため、巨大画像では時間がかかる場合があります。
- スマホでは最大長辺 1600px〜2048px 推奨です。

## 今後の拡張案

- MediaPipe / face-api.js / ONNX Runtime Web による高精度顔・人物検出
- PDF内画像への同じROI圧縮適用
- WebCodecsによる動画フレームROI圧縮
- Web Worker化によるUIのさらなる安定化
