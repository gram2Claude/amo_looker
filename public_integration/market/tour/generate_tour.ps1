# Генератор черновых тур-изображений 1188x616 для маркетплейса (ru/en).
# ВНИМАНИЕ: это макеты-черновики. Перед подачей заменить реальными скриншотами
# (см. submission_checklist.md, раздел D).
Add-Type -AssemblyName System.Drawing

$W = 1188; $H = 616
$dir = $PSScriptRoot

$colBg     = [System.Drawing.Color]::FromArgb(240, 242, 245)
$colCard   = [System.Drawing.Color]::White
$colBlue   = [System.Drawing.Color]::FromArgb(25, 118, 210)
$colText   = [System.Drawing.Color]::FromArgb(43, 50, 58)
$colMuted  = [System.Drawing.Color]::FromArgb(107, 116, 128)
$colBorder = [System.Drawing.Color]::FromArgb(227, 229, 232)
$colDim    = [System.Drawing.Color]::FromArgb(140, 0, 0, 0)

function New-Canvas {
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'ClearTypeGridFit'
    $g.Clear($colBg)
    return @($bmp, $g)
}
function F($size, $bold) {
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    New-Object System.Drawing.Font('Segoe UI', $size, $style)
}
function DrawEye($g, $cx, $cy, $r) {
    $b = New-Object System.Drawing.SolidBrush($colBlue)
    $g.FillEllipse($b, $cx - $r, $cy - $r, 2*$r, 2*$r)
    $w = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $ew = [int](1.15*$r); $eh = [int](0.62*$r)
    $g.FillEllipse($w, $cx - $ew/2, $cy - $eh/2, $ew, $eh)
    $p = New-Object System.Drawing.SolidBrush($colBlue)
    $pr = [int](0.28*$r)
    $g.FillEllipse($p, $cx - $pr, $cy - $pr, 2*$pr, 2*$pr)
}
function RoundRect($g, $brush, $x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, 2*$r, 2*$r, 180, 90)
    $path.AddArc($x+$w-2*$r, $y, 2*$r, 2*$r, 270, 90)
    $path.AddArc($x+$w-2*$r, $y+$h-2*$r, 2*$r, 2*$r, 0, 90)
    $path.AddArc($x, $y+$h-2*$r, 2*$r, 2*$r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose()
}
$bCard  = New-Object System.Drawing.SolidBrush($colCard)
$bText  = New-Object System.Drawing.SolidBrush($colText)
$bMuted = New-Object System.Drawing.SolidBrush($colMuted)
$bBlue  = New-Object System.Drawing.SolidBrush($colBlue)
$bBorder= New-Object System.Drawing.SolidBrush($colBorder)
$bDim   = New-Object System.Drawing.SolidBrush($colDim)

function FileRow($g, $x, $y, $w, $name, $withEye) {
    RoundRect $g $bCard $x $y $w 56 8
    # иконка файла
    RoundRect $g $bBorder ($x+16) ($y+12) 32 32 4
    $g.DrawString('a', (F 14 $true), $bMuted, $x+24, $y+16)
    $g.DrawString($name, (F 13 $false), $bText, $x+64, $y+16)
    if ($withEye) { DrawEye $g ($x + $w - 40) ($y + 28) 14 }
}

function Slide1($lang, $t) {
    $r = New-Canvas; $bmp = $r[0]; $g = $r[1]
    $g.DrawString($t.title1, (F 30 $true), $bText, 64, 48)
    $g.DrawString($t.sub1, (F 15 $false), $bMuted, 66, 106)
    # лента
    RoundRect $g $bCard 64 168 640 400 12
    $g.DrawString($t.feed, (F 12 $true), $bMuted, 88, 188)
    FileRow $g 88 224 590 'contract_2026.pdf' $true
    FileRow $g 88 292 590 'price_list.xlsx' $true
    FileRow $g 88 360 590 'presentation.pptx' $true
    FileRow $g 88 428 590 'photo_object.jpg' $true
    $g.DrawString($t.hint1, (F 12 $false), $bMuted, 88, 506)
    # стрелка + глазик крупно
    DrawEye $g 880 300 64
    $g.DrawString($t.click, (F 16 $true), $bText, 800, 400)
    $bmp.Save("$dir\$lang\01_eye_in_feed.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Slide2($lang, $t) {
    $r = New-Canvas; $bmp = $r[0]; $g = $r[1]
    # фон-затемнение
    $g.FillRectangle($bDim, 0, 0, $W, $H)
    # модалка
    RoundRect $g $bCard 144 60 900 500 12
    # шапка
    $g.DrawString('contract_2026.pdf', (F 14 $true), $bText, 172, 84)
    $g.DrawString($t.download, (F 12 $false), $bBlue, 800, 88)
    $g.DrawString([string][char]0x00D7, (F 20 $false), $bMuted, 990, 76)
    $g.FillRectangle($bBorder, 144, 120, 900, 2)
    # тело — страница документа
    RoundRect $g $bBorder 244 150 700 380 4
    RoundRect $g $bCard 254 160 680 360 4
    for ($i = 0; $i -lt 9; $i++) {
        $lw = 600 - ($i % 3) * 120
        $g.FillRectangle($bBorder, 290, 190 + $i*34, $lw, 10)
    }
    $g.DrawString($t.title2, (F 24 $true), [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White), 144, 575)
    $bmp.Save("$dir\$lang\02_preview_modal.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Slide3($lang, $t) {
    $r = New-Canvas; $bmp = $r[0]; $g = $r[1]
    $g.DrawString($t.title3, (F 30 $true), $bText, 64, 48)
    $y = 140
    foreach ($row in $t.formats) {
        RoundRect $g $bCard 64 $y 1060 88 10
        $g.DrawString($row[0], (F 16 $true), $bBlue, 88, $y+14)
        $g.DrawString($row[1], (F 13 $false), $bMuted, 88, $y+48)
        $y += 104
    }
    $g.DrawString($t.privacy, (F 13 $false), $bMuted, 66, $y + 8)
    $bmp.Save("$dir\$lang\03_formats_privacy.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

$ru = @{
    title1 = 'Предпросмотр файлов в один клик'
    sub1   = 'Кнопка-глазик появляется рядом с каждым вложением в ленте сделки, контакта и компании'
    feed   = 'ЛЕНТА ПРИМЕЧАНИЙ'
    hint1  = 'Скачивание больше не нужно: содержимое видно сразу'
    click  = 'Один клик —' + [char]10 + 'и файл открыт'
    download = 'Скачать'
    title2 = 'Документ открывается в окне предпросмотра'
    title3 = 'Форматы и приватность'
    formats = @(
        @('PDF, JPG, PNG, GIF, WebP, SVG, TXT, Markdown', 'Обрабатываются прямо в браузере — никуда не передаются'),
        @('DOCX, XLSX, PPTX, CSV', 'Отображение через Microsoft Office Viewer (до 15 МБ, файл публикуется временно, до 5 минут)'),
        @('DOC, XLS, PPT, RTF, ODT', 'Автоматическая конвертация в PDF на сервере разработчика (файл не сохраняется)')
    )
    privacy = 'Подробности — в политике конфиденциальности: nexus-oko.naithon.one/legal/privacy_ru.html'
}
$en = @{
    title1 = 'Preview files in one click'
    sub1   = 'An eye button appears next to every attachment in the lead, contact and company timeline'
    feed   = 'NOTES FEED'
    hint1  = 'No more downloads: see the content instantly'
    click  = 'One click —' + [char]10 + 'file is open'
    download = 'Download'
    title2 = 'The document opens in a preview window'
    title3 = 'Formats and privacy'
    formats = @(
        @('PDF, JPG, PNG, GIF, WebP, SVG, TXT, Markdown', 'Processed right in the browser — never transmitted anywhere'),
        @('DOCX, XLSX, PPTX, CSV', 'Rendered via Microsoft Office Viewer (up to 15 MB, file is published temporarily, up to 5 minutes)'),
        @('DOC, XLS, PPT, RTF, ODT', 'Converted to PDF on the developer server automatically (file is not stored)')
    )
    privacy = 'Details in the privacy policy: nexus-oko.naithon.one/legal/privacy_en.html'
}

foreach ($pair in @(@('ru', $ru), @('en', $en))) {
    $lang = $pair[0]; $t = $pair[1]
    New-Item -ItemType Directory -Force "$dir\$lang" | Out-Null
    Slide1 $lang $t
    Slide2 $lang $t
    Slide3 $lang $t
    Write-Output "tour/${lang}: 3 images"
}
