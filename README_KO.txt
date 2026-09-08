GraXpert Photoshop Panel v0.9.0
Windows Photoshop / CEP
==============================================

개요
----
GraXpert stand-alone CLI를 Photoshop의 Legacy Extension 패널에서 실행하고,
처리 결과를 원본 문서의 새 레이어로 가져옵니다.

현재 기능
---------
상단 설정 아이콘을 누르면 GPU acceleration과 GraXpert 실행 파일 설정만
표시됩니다. 다시 누르면 기존 작업 화면으로 돌아갑니다.
작업 탭 순서는 Gradient → Neutralise → Denoise입니다.

1. Gradient Removal
   - Gradient 방식: AI 자동 / Sample Point
   - Sample Point 보간 방식: RBF / Splines / Kriging
   - Smoothing 0.00 ~ 1.00
   - Correction: Subtraction / Division
   - Background model 별도 저장
   - GPU ON/OFF
   - Preview Canvas에서 수동 Sample Point 추가/삭제
   - Photoshop 선택 영역 내부 자동 Grid Sample
   - GraXpert와 동일한 Sample Size 설정(기본값 25, 약 50×50px 계산 영역)
   - Gradient 결과를 처리 시작 시 선택했던 레이어 바로 위에 배치

2. Denoise
   - Strength 0.00 ~ 1.00
   - Batch Size 1 / 2 / 4 / 8 / 16 / 32
   - Strength와 Batch Size는 카드 하단의 상세 설정 보기/숨기기로 접기
   - GPU ON/OFF
   - Denoise 결과를 처리 시작 시 선택했던 레이어 바로 위에 배치

3. Background Neutralisation
   - 메인 화면은 결과 적용, 분석/Editor, 보정 강도, 결과 생성 순서로 단순화
   - 결과 적용: 현재 레이어 / 지정 영역
   - 분석 영역: Photoshop 선택 영역 우선, 없으면 현재 레이어 마스크 사용
   - 선택 영역 분석 시 Point 품질 임계값도 마스크 내부 픽셀 통계만 사용
   - 현재 레이어 결과에서 영역이 없으면 현재 레이어 전체를 분석 영역으로 사용
   - 초록 후보는 100%, 주황 후보는 35% 가중치로 사용하고 빨간 후보는 제외
   - 후보를 최대 20개로 공간 분산하고 실제 16/32-bit RGB 색상 이상치를 추가 제외
   - 자동 분석 후 Neutralise Editor에서 Reference Point를 추가·삭제 가능
   - Sample 주변의 R/G/B 중앙값을 Neutral Gray로 보정
   - Strength 0~100%, 기본값 100%
   - 감지한 입력 영역을 새 결과 레이어의 마스크로 적용
   - 원본 레이어를 유지하고 별도 Background Neutralised 레이어 생성
   - 결과를 처리 시작 시 선택했던 레이어 바로 위에 배치
   - 16-bit unsigned/32-bit float TIFF를 행 단위로 처리해 전체 이미지를 메모리에 올리지 않음
   - 32-bit Sample은 중앙값 계산 후 원시 Float 배열 참조를 유지하지 않아 Point 수 증가 시 메모리 누적 방지
   - 32-bit 선형 문서는 float 정밀도와 0..1 범위 밖 값을 유지한 채 처리
   - 입력 TIFF의 ICC 색상 프로파일을 결과 TIFF에 그대로 유지

4. 처리 대상
   - 보이는 레이어: 현재 보이는 레이어를 작업용 문서에서만 임시 합성
   - 현재 레이어: 현재 선택한 레이어만 처리 (Gradient/Denoise 기본값)
   - 지정 영역: Photoshop 선택 영역 우선, 없으면 현재 레이어 마스크
   - 각 범위 버튼에 마우스를 올리면 하단에 상세 설명 표시

5. 결과 처리
   - Gradient/Denoise/Neutralisation 결과를 처리한 현재 레이어 바로 위에 삽입
   - 처리 시작 문서 ID가 사라지면 동일 이름 문서로 대체하지 않고 안전하게 중단
   - GraXpert 실행 중 진행 상태 옆의 "처리 취소" 버튼으로 프로세스 중단 가능
   - stdout/stderr를 스트리밍으로 소비해 10MB 출력 버퍼 초과 오류 방지
   - 30분 동안 출력이 없으면 무응답으로 판단해 중단하고 임시 입력·출력 파일 정리
   - FITS 결과를 16-bit unsigned RGB TIFF로 자동 변환
   - FITS 전체 이미지를 메모리에 올리지 않고 행 단위로 변환
   - FITS 축·픽셀 수의 안전 정수 여부와 Classic TIFF 4GB 한계를 변환 전에 검사
   - 비정상적으로 큰 FITS/TIFF 행 버퍼는 256MB에서 차단
   - TIFF IFD, 태그 데이터, Strip 위치를 실제 파일 범위와 대조한 뒤 메모리 할당
   - 손상된 TIFF가 대용량 버퍼 할당이나 파일 밖 읽기를 유발하지 않도록 차단

7. Gradient Editor / Neutralise Editor
   - Gradient 방식은 AI 자동 / 배경 포인트로 구분
   - 배경 포인트 선택 시 Gradient 방식 카드 안에 상태, 포인트 자동 생성, Gradient Editor만 표시
   - 보간 방식은 Gradient 세부 설정으로 이동하고 밀도·품질 기준·Radius는 Gradient Editor에서 조정
   - 포인트 자동 생성 버튼으로 Preview 준비와 Grid 생성을 한 번에 실행
   - 행당 포인트: GraXpert와 동일한 4~25 범위, 기본값 15
   - Grid Tolerance: 전역 중앙값과 MAD를 이용해 밝은 Grid 후보를 1차 제외, 기본값 1.0
   - Gradient Editor 버튼은 Preview가 없으면 자동 준비 후 편집 창 실행
   - 메인 패널의 Canvas는 숨기고 독립 Modeless Editor를 기본 편집 화면으로 사용
   - Gradient Point는 GraXpert Gradient Editor에서 편집
   - Neutralise Reference Point는 GraXpert Neutralise Editor에서 별도로 편집
   - 두 Editor는 서로 다른 상태 파일과 CEP 이벤트 채널을 사용해 Point 상태가 섞이지 않음
   - Preview Stretch와 Saturation은 각 Modeless Editor에서만 표시
   - Photoshop 확장 메뉴에는 GraXpert만 표시하며 Editor는 메인 패널 버튼으로만 실행
   - Photoshop 선택 영역이 있으면 처리 범위와 별개로 자동 Point를 선택 내부에 생성
   - Point 생성 영역과 Gradient 결과 적용 영역은 포인트 상태에 마우스를 올려 확인
   - 좌클릭으로 추가, 우클릭으로 Sample 사각 영역 안의 Point 삭제
   - 마지막 삭제 / 전체 삭제
   - 선택한 밀도에 따른 자동 Grid 생성
   - Photoshop 선택 영역이 있으면 선택 내부로 자동 Grid 제한
   - 선택 영역을 임시 Alpha Channel로 보존해 Preview mask에 정확히 전달
   - 선택 제한이 켜진 상태에서 선택을 인식하지 못하면 전체 Grid 생성 차단
   - CEP 패널 표시 크기와 Canvas 내부 크기를 일치시켜 클릭 좌표 보정
   - 패널 창 크기 변경 시 Preview와 Point 위치 자동 재배치
   - Gradient Editor 버튼으로 독립 편집 창 실행
   - Gradient Editor와 메인 패널의 Point, 행당 포인트, Grid Tolerance, 추가 품질 검사, Stretch, Saturation, Sample Size 및 선택 제한 실시간 동기화
   - Preview 생성 당시 문서 ID, 현재 레이어 ID, 처리 범위와 분석 영역 경계를 저장
   - 실행 전에 Preview 작업 문맥을 다시 검사하고 변경되었으면 재분석 요청
   - Gradient/Neutralise 탭 또는 Neutralise 결과 적용 범위를 바꾸면 기존 Preview와 Point 초기화
   - 큰 창 크기에 맞춘 Preview 자동 확대와 좌클릭 추가/우클릭 삭제
   - 한 번의 버튼 클릭으로 큰 창 활성화 및 헤더의 '창 닫기' 지원
   - GraXpert와 동일하게 Point 중심에서 Sample Size만큼 확장한 사각 계산 영역을 테두리 2px로 표시
     (Sample Size 25이면 원본 이미지 기준 약 50×50px)
   - Preview 전역 밝기와 Sample 주변 밝기 분포 분석
   - Point 품질을 적합(초록), 주의(주황), 제외(빨강)로 표시
   - 자동 Grid에서 과도하게 밝은 영역 제외
   - 빨간 Point는 GraXpert preferences에서 제외
   - 국소 중앙값과 이상 밝은 픽셀 비율로 별 밀집 영역 감지
   - Sample 중심부와 외곽부 밝기 차이로 은하 중심 구조 회피
   - Point에 마우스를 올리면 판정 사유와 원본 좌표 표시
   - Grid 중심이 부적합하면 같은 셀의 안전한 위치로 자동 재배치
   - 적합한 중심점은 유지해 Grid 균일성 보존
   - Sample Size로 계산한 영역을 5×5로 검사해 전체가 Selection 내부인 후보만 사용
   - 자동 Grid 완료 후 재배치 수와 사용할 수 없는 셀 수 표시
   - 품질 분석 강도: 느슨함 / 표준 / 엄격함
   - 프리셋 변경 시 기존 Point 색상·점수·제외 상태 실시간 재분석
   - 적합·주의·제외 수, 평균 점수 및 판정 사유별 요약 표시
   - GraXpert 표시 프리셋: No Stretch / 10% / 15% / 20% / 30% Background
   - Sample Preview Stretch 기본값: No Stretch
   - Median/MAD 기반 shadow clipping 및 MTF Preview Stretch
   - Preview Saturation: 0.0~3.0, 기본값 1.0 (Stretch 이후 미리보기에만 적용)
   - Stretch는 Sample Preview 표시에만 적용하고 품질 분석 픽셀은 선형 상태 유지
   - Gradient/Denoise 실행은 항상 선형 결과 레이어만 생성
   - 실제 Stretched 결과 생성 기능과 전용 Editor는 StarNet2 Photoshop Panel로 이동
   - Gradient/Denoise/Neutralisation 결과를 지정 영역에만 표시하는 비파괴 레이어 마스크
   - 성공·실패 시 지정 영역 임시 알파 채널 정리 및 기존 선택 영역 복원


필수 준비
---------
GraXpert Windows 실행 파일을 먼저 설치하거나 다운로드합니다.

명령 프롬프트에서 다음 명령이 실행되는지 확인하세요.

GraXpert-win64.exe -h

PATH에 등록하지 않았다면 패널의 "GraXpert 실행 파일"에 전체 경로를
입력하고 [저장]을 누릅니다.

예:
C:\AstroTools\GraXpert-win64.exe


설치
----
1. Photoshop 완전히 종료
2. ZIP 압축 해제
3. Install_Windows.bat 실행
4. 모든 단계가 [OK]인지 확인
5. Photoshop 재실행
6. Window > Extensions (Legacy) > GraXpert

설치 위치:
%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel

이 패널은 서명되지 않은 CEP 확장이므로 설치 프로그램이 현재 사용자의
CSXS.9 ~ CSXS.15 PlayerDebugMode를 1로 설정합니다. 설치 전 Photoshop 실행
여부와 대상 경로를 확인하고, 복사한 핵심 파일이 원본과 같은지도 검증합니다.
파일 복사 또는 레지스트리 설정/검증이 실패하면 설치 프로그램은 오류 코드로
종료합니다.

제거
----
1. Photoshop 완전히 종료
2. Uninstall_Windows.bat 실행
3. 다른 서명되지 않은 CEP 패널을 사용한다면 PlayerDebugMode는 기본값대로 보존

제거 프로그램은 GraXpert 패널 설치 폴더만 삭제하며 Documents의 Background
model과 임시 진단 파일은 삭제하지 않습니다. PlayerDebugMode는 여러 CEP 패널이
공유하므로 기본값은 보존입니다. 명령줄에서 레지스트리 값까지 제거하려면
Uninstall_Windows.bat /remove-debug를 사용하고, 질문 없이 보존하려면
Uninstall_Windows.bat /keep-debug를 사용합니다.


Background model 저장
---------------------
"Background model도 저장"을 선택하면 GraXpert가 생성한 배경 모델을
임시 폴더에서 다음 영구 폴더로 복사합니다.

%USERPROFILE%\Documents\GraXpert Background Models

파일명:
원본문서명_GraXpert_background_타임스탬프.fits

저장 성공 후 임시 배경 파일은 삭제됩니다. 영구 저장에 실패하면 결과
유실을 막기 위해 임시 파일을 보존하고 패널 메시지에 경로를 표시합니다.


Background Neutralisation
-------------------------
1. Stretch 이전의 선형 레이어를 활성화합니다.
2. Photoshop 선택 영역을 만들거나 현재 레이어에 영역 마스크를 준비합니다.
3. Neutralise 탭에서 "배경 분석"을 실행합니다.
4. 자동으로 표시된 초록색/주황색 Background 후보를 확인합니다.
5. Preview 예상 보정 필요도, RGB 이동량과 권장 Strength를 확인합니다.
6. 보정 강도를 정하고 "중화 레이어 생성"을 실행합니다.

자동 분석은 행당 포인트 설정을 기준으로 Grid를 만들고 후보가 한쪽에 몰리지
않도록 최대 20개를 선택합니다. 초록색 후보는 100%, 주황색 후보는 35%의
가중치로 중앙값 계산에 사용하며 빨간색 후보는 제외합니다. 이어서 원본
실제 RGB 데이터에서 다른 후보와 색상 비율이 크게 다른 위치를 MAD 기반으로 한 번
더 제외합니다. 안전한 후보가 5개 미만이면 보정을 중단합니다. 선택 영역을
넓혀 다시 분석하거나 Neutralise Editor에서 후보 위치를 보정할 수 있습니다.

두 결과 적용 방식 모두 Photoshop 선택 영역을 우선 분석하며, 선택이 없으면
현재 레이어 마스크를 분석 영역으로 사용합니다. "현재 레이어"는 두 영역이 모두
없을 때 현재 레이어 전체를 분석하고, 결과를 전체 레이어에 적용하며 결과 마스크를
만들지 않습니다. "지정 영역"은 분석 영역이 반드시 필요하며, 같은 영역을 결과
레이어의 마스크로 적용합니다. 원본 레이어는 변경하지 않습니다.

완료 메시지는 실제 16/32-bit 원본에서 계산한 채널 차이, 적용 RGB 이동량과
채널별 범위 이탈 또는 클리핑 비율을 표시합니다. 16-bit는 저장 범위로 제한하고,
32-bit float는 음수 및 1 초과 값을 자르지 않고 보존합니다. 지정 영역 모드의 통계는 마스크가
적용되기 전 처리 버퍼 전체를 계산하므로 마스크 밖 전경도 포함합니다.
입력 TIFF에 ICC 색상 프로파일이 내장되어 있으면 결과에도 같은 프로파일을 기록하며,
완료 메시지에서 프로파일 유지 여부를 확인할 수 있습니다.


처리 구조와 임시 파일
---------------------
Photoshop 원본 문서
-> Sample Preview 및 Photoshop Selection mask 생성
-> 원본 이미지 좌표로 Background Point 편집
-> 선택한 GraXpert MTF Stretch로 Sample Preview만 표시
-> GraXpert preferences JSON 생성
-> 작업용 복제 문서
-> Gradient/Denoise는 RGB 16-bit TIFF, Neutralise는 원본과 같은 16/32-bit TIFF 입력 생성
-> 작업용 복제 문서 닫기 및 원본 문서 복구
-> GraXpert CLI 실행
-> FITS 결과 생성
-> 1차 순차 읽기로 픽셀 범위 계산
-> 2차 행 단위 16-bit unsigned 또는 32-bit float RGB TIFF 기록
-> 원본 문서에 결과 레이어 삽입
-> 필요하면 BlurXTerminator 등 선형 후처리 실행
-> 하늘 Background 자동 분석 및 Background Neutralised 레이어 생성
-> 필요하면 StarNet2 Photoshop Panel의 Stretch에서 별도 표시 레이어 추가
-> 성공한 작업의 임시 파일 삭제

RBF/Splines/Kriging preferences 주요 형식:

{
  "interpol_type_option": "RBF",
  "background_points": [[325, 210, 1], [870, 195, 1]],
  "sample_size": 25,
  "smoothing_option": 0.3,
  "corr_type": "Subtraction",
  "RBF_kernel": "thin_plate",
  "spline_order": 3
}

임시 위치:
%TEMP%\GraXpert_Photoshop

오류 발생 시 진단을 위해 입력, 출력 및 변환 정보를 보존합니다. 패널 시작
시 3일 이상 지난 input_*, output_*, photoshop_*, conversion_*, preview_*,
mask_*, preferences_*, stretch_*, neutral_* 파일을 정리합니다.


권장 설정
---------
Gradient Removal 시작값:
- Gradient 방식: AI 자동 또는 수동 Background 지정이 필요한 경우 Sample Point
- Sample Point 보간 방식: RBF (필요한 경우 Splines/Kriging 선택)
- Smoothing: 0.00 (GraXpert 기본값)
- Correction: Subtraction
- 처리 대상: 현재 레이어만
- GPU: ON

Denoise 시작값:
- Strength: 0.40 ~ 0.50
- Batch Size: 4
- 처리 대상: 현재 레이어만
- GPU: ON

VRAM 부족 또는 OOM 발생 시 Batch Size를 2 또는 1로 낮추세요.

산, 계곡, 건물 등 전경이 포함된 사진은 하늘을 별도 픽셀 레이어로
분리한 뒤 "현재 레이어만"으로 처리하는 것을 권장합니다. 그룹이나 조정
레이어보다는 전체 프레임 크기의 픽셀 레이어를 선택하세요.


실행 중 주의사항
----------------
현재 버전은 GraXpert를 직접 실행하며 별도 Job Recovery 기능이 없습니다.
처리가 끝날 때까지 다음 항목을 유지하세요.

- CEP 패널을 닫지 않기
- 독립 Gradient/Neutralise Editor 사용 중 메인 GraXpert 패널을 닫지 않기
- 원본 문서를 닫거나 이름을 변경하지 않기
- 원본 캔버스 크기를 변경하지 않기

'큰 창에서 편집'은 별도 CEP 패널 등록을 사용합니다. 새 버전을 설치한 뒤
Photoshop을 완전히 종료하고 다시 실행해야 메뉴와 버튼 연결이 갱신됩니다.


진단
----
Diagnose_Install.bat는 다음 항목을 확인합니다.

- 소스 manifest.xml 존재 여부
- 설치된 manifest.xml 존재 여부
- CSXS.9 ~ CSXS.15 PlayerDebugMode=1 여부
- GraXpert-win64.exe PATH 등록 여부

문제 보고 시 다음 정보를 함께 제공하세요.

- Diagnose_Install.bat 실행 결과
- Photoshop 버전
- GraXpert 버전
- 패널 오류 메시지 전체
- %TEMP%\GraXpert_Photoshop의 관련 conversion_*.txt


자동 테스트
-----------
Node.js가 설치된 개발 환경에서 프로젝트 루트에서 실행합니다.

node tests\run-tests.js

실제 Photoshop까지 포함한 통합 테스트는 다음 명령으로 실행합니다.

powershell -NoProfile -ExecutionPolicy Bypass -File tests\Run_Photoshop_Integration.ps1

통합 테스트는 Photoshop COM을 통해 16-bit TIFF 왕복, 32-bit Neutralise TIFF 및 ICC 프로파일 보존,
단일 Background 레이어,
선택 영역/현재 레이어 마스크 기반 지정 영역 처리, 결과 레이어 마스크, Sample Preview를
실제로 검사합니다. 실행 전에 Photoshop이 열려 있었다면 종료하지 않으며, 테스트가
Photoshop을 직접 실행한 경우에만 완료 후 종료합니다. 결과는
tests\Photoshop_Integration_Result.txt에 저장됩니다.

테스트 범위:
- Float32 grayscale FITS 변환
- Float32 RGB planar FITS 변환
- BITPIX 16 및 BSCALE/BZERO 변환
- 안전 범위를 벗어난 FITS 크기와 Classic TIFF 4GB 초과 방지
- 손상된 TIFF IFD·태그 수·Strip 오프셋 방어
- Background model 영구 저장과 임시 파일 정리
- Photoshop 입력 변환 실패 시 임시 문서 정리와 원본 복구
- 단일 Background 레이어의 현재 레이어 내보내기 시 불필요한 표시/숨기기 명령 방지
- Photoshop 선택 영역 저장·복원과 하늘 결과 레이어 마스크 적용
- Sample Preview/Selection mask 생성 후 임시 문서 정리와 원본 복구
- HTML div 태그 균형
- 독립 Gradient Editor HTML 구조와 메인 패널 동기화 연결
- 설치 프로그램의 레지스트리 오류 검사 코드
- GraXpert preferences JSON 구조와 `-preferences_file` CLI 전달
- 가로/세로 Preview의 Canvas 크기 및 클릭 좌표 변환
- 어두운 배경과 밝은 패치의 Sample 품질 분류
- 별 밀집 패턴과 넓은 중심 광원 패턴 분류
- 적합 중심점 우선 및 제외 중심점 대체 후보 선택
- 품질 프리셋 임계값 순서와 실시간 분류 차이
- 광해 기울기·은하수 확산 구조·지상 경계가 포함된 대표 장면의 자동 Point 회귀 검사
- 선택 마스크 내부의 좁은 구멍과 복잡한 경계를 Sample 영역이 침범하지 않는지 검사
- 선택 영역 밖의 밝은 지상 전경이 하늘 Point 품질 통계에 포함되지 않는지 검사
- Preview MTF Stretch와 Saturation 표시
- 처리 시작 시 선택한 레이어 ID 보존과 결과 바로 위 배치
- Sample Point RGB 중앙값 기반 16/32-bit Background Neutralisation
- RGB 편향 중화 후 부드러운 광해 기울기와 ICC 프로파일이 유지되는지 수치 검사
- Neutralise 입출력 경로 충돌 시 원본 보호 및 출력 쓰기 실패 시 불완전 TIFF 정리
- 실제 Photoshop의 선택 영역 및 현재 레이어 마스크 통합 처리


권장 선형 후처리 순서
--------------------
1. GraXpert Gradient 실행: 선형 Gradient 레이어 생성
2. Gradient 레이어를 복제하고 BlurXTerminator 등 선형 처리 실행
3. 처리된 선형 레이어에서 Background Neutralisation 실행
4. Background Neutralised 레이어를 활성화
5. StarNet2 Photoshop Panel에서 Stretch Editor 또는 Stretched 레이어 생성을 실행

최종 레이어 예:
- GraXpert - RBF Gradient - BXT - Background Neutralised - Stretched (15% Bg, 3 sigma)
- GraXpert - RBF Gradient - BXT - Background Neutralised
- GraXpert - RBF Gradient - BXT
- GraXpert - RBF Gradient


문서 안내
---------
이 파일이 현재 버전의 기준 문서입니다. README_v1_*.txt 파일은 이전
버전의 변경 과정과 문제 해결 기록을 보존한 역사 문서이며, 현재 동작은
이 README_KO.txt를 우선합니다.
