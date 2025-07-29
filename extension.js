const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * CodeIgniter 3 모델 파일명을 생성하는 함수
 * layer_banner_model -> Layer_banner_model.php
 */
function getModelFileName(modelName) {
	const parts = modelName.split('_');
	const capitalizedParts = parts.map(part =>
		part.charAt(0).toUpperCase() + part.slice(1)
	);
	return capitalizedParts.join('_') + '.php';
}

/**
 * app으로 시작하는 폴더들을 찾기
 */
function findAppFolders(projectRoot) {
	try {
		const items = fs.readdirSync(projectRoot, { withFileTypes: true });
		const appFolders = items
			.filter(item => item.isDirectory() && item.name.startsWith('app'))
			.map(item => item.name);
		
		// app_common을 우선순위로 두기
		const sortedFolders = appFolders.sort((a, b) => {
			if (a === 'app_common') return -1;
			if (b === 'app_common') return 1;
			return a.localeCompare(b);
		});
		
		return sortedFolders.length > 0 ? sortedFolders : ['app_common', 'app'];
	} catch (error) {
		console.error('Error reading app folders:', error);
		return ['app_common', 'app']; // 기본값
	}
}

/**
 * 파일에서 모든 모델 로드 구문을 파싱하는 함수
 */
function parseModelLoads(fullText) {
	const modelLoads = [];
	const loadRegex = /load->model\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

	// $this->load->model() 패턴 찾기
	let match;
	while ((match = loadRegex.exec(fullText)) !== null) {
		let fullModelPath = match[1]; // 예: common/ebei_model 또는 ebei_model

		// 모델명 추출 (경로의 마지막 부분)
		const pathParts = fullModelPath.split('/');
		const rawFileName = pathParts.pop(); // ebei_model

		// 파일명 맨 앞 대문자로 변환
		const capitalizedFileName = rawFileName.charAt(0).toUpperCase() + rawFileName.slice(1);

		// 확장자 추가 (.php는 이 함수 밖에서 붙일 수도 있음)
		const capitalizedFullPath = [...pathParts, capitalizedFileName].join('/');

		modelLoads.push({
			fullPath: capitalizedFullPath,
			modelName: rawFileName
		});
	}

	return modelLoads;
}

/**
 * 워크스페이스에서 모델 파일을 찾는 함수 (수정된 버전)
 */
function findModelFile(workspaceRoot, modelPath) {
	const modelName = path.basename(modelPath);
	const modelDir = path.dirname(modelPath);
	
	// CI3 프로젝트 구조 확인
	const ci3ProjectPath = path.join(workspaceRoot, 'CI3');
	const projectRoot = fs.existsSync(ci3ProjectPath) ? ci3ProjectPath : workspaceRoot;
	
	// app으로 시작하는 모든 폴더 찾기
	const appFolders = findAppFolders(projectRoot);
	
	const possiblePaths = [];
	
	// 각 app 폴더에서 모델 파일 검색
	appFolders.forEach(appFolder => {
		// 1. 원본 경로 그대로 (소문자)
		possiblePaths.push(
			path.join(projectRoot, appFolder, 'models', modelPath + '.php')
		);
		
		// 2. CI3 네이밍 컨벤션 적용 (디렉토리 포함)
		if (modelDir !== '.') {
			possiblePaths.push(
				path.join(projectRoot, appFolder, 'models', modelDir, getModelFileName(modelName))
			);
		}
		
		// 3. CI3 네이밍 컨벤션 적용 (디렉토리 없음)
		possiblePaths.push(
			path.join(projectRoot, appFolder, 'models', getModelFileName(modelName))
		);
	});
	
	// 파일 존재 여부 확인
	for (const filePath of possiblePaths) {
		const exists = fs.existsSync(filePath);
		if (exists) {
			return filePath;
		}
	}
	
	return null;
}

/**
 * 메서드 주석을 추출하는 함수
 */
function extractMethodComment(lines, methodLineIndex) {
	let comments = [];
	let i = methodLineIndex - 1;
	
	// 메서드 바로 위의 주석을 찾기 위해 역순으로 탐색
	while (i >= 0) {
		const line = lines[i].trim();
		
		// 빈 줄은 건너뛰기
		if (line === '') {
			i--;
			continue;
		}
		
		// /** */ 스타일 주석 처리
		if (line.endsWith('*/')) {
			// 여러 줄 주석의 끝을 찾았으므로 시작까지 역순으로 수집
			let commentLines = [];
			let j = i;
			
			while (j >= 0) {
				const commentLine = lines[j].trim();
				commentLines.unshift(commentLine);
				
				if (commentLine.startsWith('/**') || commentLine.startsWith('/*')) {
					break;
				}
				j--;
			}
			
			// 주석 내용 정리
			comments = commentLines.map(line => {
				return line
					.replace(/^\/\*\*?/, '')  // /** 또는 /* 제거
					.replace(/\*\/$/, '')     // */ 제거
					.replace(/^\s*\*/, '')    // 앞의 * 제거
					.trim();
			}).filter(line => line !== ''); // 빈 줄 제거
			
			break;
		}
		
		// // 스타일 주석 처리
		if (line.startsWith('//')) {
			let commentLines = [];
			let j = i;
			
			// 연속된 // 주석들을 모두 수집
			while (j >= 0 && lines[j].trim().startsWith('//')) {
				commentLines.unshift(lines[j].trim().substring(2).trim());
				j--;
			}
			
			comments = commentLines;
			break;
		}
		
		// # 스타일 주석 처리 (PHP에서도 사용 가능)
		if (line.startsWith('#')) {
			let commentLines = [];
			let j = i;
			
			// 연속된 # 주석들을 모두 수집
			while (j >= 0 && lines[j].trim().startsWith('#')) {
				commentLines.unshift(lines[j].trim().substring(1).trim());
				j--;
			}
			
			comments = commentLines;
			break;
		}
		
		// 다른 코드가 나오면 주석 없음으로 판단
		break;
	}
	
	return comments.join('\n');
}


/**
 * 모델 파일에서 특정 메소드를 찾는 함수 (주석 포함)
 */
function findMethodInFile(filePath, methodName) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split(/\r?\n/);
		
		const methodRegex = new RegExp(
			`function\\s+${methodName}\\s*\\(`,
			'i'
		);
		
		for (let i = 0; i < lines.length; i++) {
			if (methodRegex.test(lines[i])) {
				const comment = extractMethodComment(lines, i);
				const declaration = extractFunctionDeclaration(lines, i);
				
				// methodName의 위치 찾기
				const character = lines[i].indexOf(methodName);
				
				return {
					line: i,
					character: character >= 0 ? character : 0,
					comment: comment,
					declaration: declaration
				};
			}
		}
	} catch (error) {
		console.error('Error reading model file:', error);
		return {
			line: 0,
			character: 0,
			comment: '',
			declaration: ''
		};
	}
}

// 함수 선언부를 추출하는 새로운 함수 추가
function extractFunctionDeclaration(lines, startLine) {
	let declaration = lines[startLine].trim();
	let currentLine = startLine;
	
	// 함수 선언이 여러 줄에 걸쳐 있을 수 있으므로 ')'를 찾을 때까지 계속 읽기
	while (currentLine < lines.length) {
		const line = lines[currentLine].trim();
		
		// 첫 번째 줄이 아니라면 추가
		if (currentLine !== startLine) {
			declaration += ' ' + line;
		}
		
		// 함수 선언 끝을 찾기 (닫는 괄호와 여는 중괄호)
		if (line.includes(')') && (line.includes('{') || lines[currentLine + 1]?.trim().startsWith('{'))) {
			break;
		}
		
		currentLine++;
		
		// 무한 루프 방지
		if (currentLine - startLine > 10) {
			break;
		}
	}
	
	return declaration;
}

function resolveModelMethodInfo(document, position) {
	const line = document.lineAt(position).text;
	const match = (/(\w+_(?:model|vo))->(\w+)/).exec(line);
	const modelLoads = parseModelLoads(document.getText());
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!document.getWordRangeAtPosition(position)) return null;
	if (!match || !workspaceFolders?.length) return null;

	const modelVar = match[1];
	const methodName = match[2];
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	const matchedModel = modelLoads.find(m => m.modelName === modelVar);
	if (!matchedModel) return null;

	const modelFilePath = findModelFile(workspaceRoot, matchedModel.fullPath);
	if (!modelFilePath) return null;

	const methodInfo = findMethodInFile(modelFilePath, methodName);
	if (!methodInfo) return null;

	return { modelFilePath, methodInfo, methodName };
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Definition Provider 등록
	const definitionProvider = vscode.languages.registerDefinitionProvider(
		{ language: 'php' },
		{
			provideDefinition(document, position) {
				const result = resolveModelMethodInfo(document, position);
				if (!result) return null;

				const { methodInfo } = result;

				return new vscode.Location(
					vscode.Uri.file(result.modelFilePath),
					new vscode.Position(methodInfo.line, methodInfo.character)
				);
			}
		}
	);
	
	// Hover Provider 등록
	const hoverProvider = vscode.languages.registerHoverProvider(
		{ language: 'php' },
		{
			provideHover(document, position) {
				const result = resolveModelMethodInfo(document, position);
				if (!result) return;

				const { methodInfo } = result;
				const hoverText = new vscode.MarkdownString();

				hoverText.appendMarkdown(`**Smart CI**\n\n`);

				if (methodInfo.declaration) {
					hoverText.appendCodeblock(`<?php\n${methodInfo.declaration}`, 'php');
					hoverText.appendMarkdown('\n');
				}

				if (methodInfo.comment) {
					const formatted = methodInfo.comment
						.split('\n').map(line => line.trim())
						.filter(Boolean)
						.join('  \n');
					hoverText.appendMarkdown(`${formatted}\n`);
				}

				return new vscode.Hover(hoverText);
			}
		}
	);
	
	// 컨텍스트에 추가
	context.subscriptions.push(definitionProvider);
	context.subscriptions.push(hoverProvider);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};