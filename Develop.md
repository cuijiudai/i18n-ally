#  VSCode 插件打包发布指南 

## 1. 安装打包工具
```bash 
  npm install -g vsce
```
## 2. 生成版本
```bash
  npm run release
```

## 3. 打包插件
```bash
  vsce package
```
生成 .vsix 文件后可在VSCode中通过"Install from VSIX"测试

## 4. 发布插件
```bash
  vsce publish
```

## 注意：发布前需要：
  * 在 https://aka.ms/vscode-create-publisher 注册发布者账号
  * 在Azure DevOps生成Personal Access Token（需Marketplace的Manage权限）