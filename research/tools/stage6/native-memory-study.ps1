param(
    [string]$Artifacts = 'research\tools\stage6\results\igblast-speed-20261111T174346358Z\browser-artifacts',
    [string]$Database = 'research\tools\stage6\results\igblast-native-only-20261111T174944415Z\native-db',
    [switch]$Smoke,
    [switch]$BatchComparison
)
$ErrorActionPreference = 'Stop'
if ($Smoke -and $BatchComparison) { throw 'Choose either Smoke or BatchComparison.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$artifacts = (Resolve-Path (Join-Path $root $Artifacts)).Path
$database = (Resolve-Path (Join-Path $root $Database)).Path
$exe = (Resolve-Path (Join-Path $root 'bin\igblastn.exe')).Path
$source = (Resolve-Path (Join-Path $root 'research\tools\stage6\results\query-10000.fasta')).Path
foreach ($file in @('Homo_sapiens_IGH_VDJ.ndm', 'Homo_sapiens_IGH_VDJ.aux', 'Homo_sapiens_IGH_VDJ_V.fasta', 'Homo_sapiens_IGH_VDJ_D.fasta', 'Homo_sapiens_IGH_VDJ_J.fasta')) {
    if (-not (Test-Path (Join-Path $artifacts $file) -PathType Leaf)) { throw "Missing reference: $file" }
}
foreach ($file in @('V.nin','D.nin','J.nin','internal_data\human\human_V.nin')) {
    if (-not (Test-Path (Join-Path $database $file) -PathType Leaf)) { throw "Missing database: $file" }
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MemoryCounters {
    [StructLayout(LayoutKind.Sequential)]
    public struct Counters {
        public uint cb, PageFaultCount;
        public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage,
            QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage,
            PagefileUsage, PeakPagefileUsage, PrivateUsage;
    }
    [DllImport("psapi.dll", SetLastError=true)]
    public static extern bool GetProcessMemoryInfo(IntPtr process, ref Counters counters, uint size);
    public static Counters Read(IntPtr process) {
        var c = new Counters();
        c.cb = (uint)Marshal.SizeOf(typeof(Counters));
        if (!GetProcessMemoryInfo(process, ref c, c.cb))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return c;
    }
}
'@

$runDir = Join-Path $root ('research\tools\stage6\results\native-memory-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Path $runDir | Out-Null
$records = [regex]::Split([IO.File]::ReadAllText($source), '(?m)(?=^>)') | Where-Object { $_ -match '^>' }
if ($records.Count -ne 10000) { throw "Expected 10000 input records, found $($records.Count)" }
$inputs = @{}
$idsByCount = @{}
foreach ($count in @(10,1000,10000)) {
    $ids = New-Object 'System.Collections.Generic.HashSet[string]'
    $selected = $records[0..($count - 1)]
    foreach ($record in $selected) {
        $id = ($record -split '\r?\n', 2)[0].Substring(1) -split '\s' | Select-Object -First 1
        if (-not $ids.Add($id)) { throw "Duplicate query ID $id" }
    }
    $query = Join-Path $runDir "query-$count.fasta"
    [IO.File]::WriteAllText($query, ($selected -join ''), (New-Object Text.UTF8Encoding($false)))
    $inputs[$count] = $query
    $idsByCount[$count] = $ids
}
if ($BatchComparison) {
    foreach ($batch in 1..10) {
        $key = 'batch{0:D2}' -f $batch
        $selected = $records[(($batch - 1) * 1000)..($batch * 1000 - 1)]
        $ids = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($record in $selected) {
            $id = ($record -split '\r?\n', 2)[0].Substring(1) -split '\s' | Select-Object -First 1
            if (-not $ids.Add($id)) { throw "Duplicate query ID $id" }
        }
        $query = Join-Path $runDir "$key.fasta"
        [IO.File]::WriteAllText($query, ($selected -join ''), (New-Object Text.UTF8Encoding($false)))
        $inputs[$key] = $query
        $idsByCount[$key] = $ids
    }
}

$measurements = @()
$env:BLAST_USAGE_REPORT = '0'
$cases = @(@(10,1), @(1000,1), @(10000,1), @(1000,2), @(1000,4), @(1000,8))
$repeats = 3
if ($Smoke) { $cases = ,@(10,1); $repeats = 1 }
if ($BatchComparison) {
    $cases = ,@(10000,1,10000)
    foreach ($batch in 1..10) { $cases += ,@(1000,1,('batch{0:D2}' -f $batch)) }
    $repeats = 1
    $mergedPath = Join-Path $runDir 'batches-combined.tsv'
    $allBatchIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $wholeRows = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    $expectedHeader = $null
    $batchValidation = $null
}
foreach ($case in $cases) {
    $count = $case[0]; $threads = $case[1]
    $key = $count
    if ($BatchComparison) { $key = $case[2] }
    for ($rep = 1; $rep -le $repeats; $rep++) {
        $tag = "n${count}-t${threads}-r${rep}"
        if ($BatchComparison) {
            if ($key -eq 10000) { $tag = 'whole' } else { $tag = $key }
        }
        $output = Join-Path $runDir "$tag.tsv"
        $stderr = Join-Path $runDir "$tag.stderr"
        $args = @('-query', $inputs[$key], '-germline_db_V', 'V', '-germline_db_D', 'D', '-germline_db_J', 'J',
            '-custom_internal_data', (Join-Path $artifacts 'Homo_sapiens_IGH_VDJ.ndm'),
            '-auxiliary_data', (Join-Path $artifacts 'Homo_sapiens_IGH_VDJ.aux'),
            '-organism', 'human', '-domain_system', 'imgt', '-ig_seqtype', 'Ig',
            '-outfmt', '19', '-num_threads', "$threads", '-out', $output)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exe
        $psi.WorkingDirectory = $database
        $psi.Arguments = ($args | ForEach-Object { '"' + $_ + '"' }) -join ' '
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardError = $true
        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $psi
        $clock = [Diagnostics.Stopwatch]::StartNew()
        if (-not $p.Start()) { throw "Failed to start $tag" }
        $handle = $p.Handle
        $errTask = $p.StandardError.ReadToEndAsync()
        [UInt64]$peakWorking = 0; [UInt64]$peakCommit = 0; $samples = 0
        while (-not $p.HasExited) {
            try { $c = [MemoryCounters]::Read($handle) }
            catch {
                if ($p.HasExited) { break }
                throw
            }
            $peakWorking = [Math]::Max($peakWorking, $c.PeakWorkingSetSize.ToUInt64())
            $peakCommit = [Math]::Max($peakCommit, $c.PeakPagefileUsage.ToUInt64())
            $samples++
            if ($clock.Elapsed.TotalSeconds -gt 600) { $p.Kill(); $p.WaitForExit(); throw "Timeout: $tag" }
            Start-Sleep -Milliseconds 100
        }
        try {
            $c = [MemoryCounters]::Read($handle)
            $peakWorking = [Math]::Max($peakWorking, $c.PeakWorkingSetSize.ToUInt64())
            $peakCommit = [Math]::Max($peakCommit, $c.PeakPagefileUsage.ToUInt64())
        } catch { }
        $p.WaitForExit(); $clock.Stop()
        [IO.File]::WriteAllText($stderr, $errTask.Result)
        if ($p.ExitCode -ne 0 -or $samples -eq 0 -or -not (Test-Path $output)) { throw "$tag failed: exit $($p.ExitCode); see $stderr" }
        $reader = [IO.File]::OpenText($output)
        $writer = $null
        try {
            $headerLine = $reader.ReadLine()
            if ($BatchComparison) {
                if ($key -eq 10000) { $expectedHeader = $headerLine }
                elseif ($headerLine -ne $expectedHeader) { throw "$tag AIRR header differs from whole output" }
                if ($key -ne 10000) {
                    $writer = [IO.File]::AppendText($mergedPath)
                    if ($key -eq 'batch01') { $writer.WriteLine($headerLine) }
                }
            }
            $header = $headerLine -split "`t"
            $idCol = [Array]::IndexOf($header, 'sequence_id')
            $vCol = [Array]::IndexOf($header, 'v_call')
            if ($idCol -lt 0 -or $vCol -lt 0) { throw "$tag missing AIRR columns" }
            $seen = New-Object 'System.Collections.Generic.HashSet[string]'
            $called = 0; $rows = 0
            while (($line = $reader.ReadLine()) -ne $null) {
                $fields = $line -split "`t", 0, 'SimpleMatch'
                if ($fields.Count -ne $header.Count -or -not $idsByCount[$key].Contains($fields[$idCol]) -or -not $seen.Add($fields[$idCol])) { throw "$tag has malformed or unexpected row" }
                if ($writer) {
                    if (-not $allBatchIds.Add($fields[$idCol])) { throw "$tag duplicates batch ID $($fields[$idCol])" }
                    $writer.WriteLine($line)
                } elseif ($BatchComparison) {
                    if ($wholeRows.ContainsKey($fields[$idCol])) { throw "$tag duplicates whole-run ID $($fields[$idCol])" }
                    $wholeRows.Add($fields[$idCol], $line)
                }
                if ($fields[$vCol]) { $called++ }
                $rows++
            }
            if ($rows -ne $count -or $called -eq 0) { throw "$tag invalid rows=$rows v_calls=$called" }
        } finally { $reader.Dispose(); if ($writer) { $writer.Dispose() } }
        $m = [ordered]@{ name=$tag; records=$count; threads=$threads; repetition=$rep; elapsedSeconds=[Math]::Round($clock.Elapsed.TotalSeconds,2); peakWorkingSetBytes=$peakWorking; peakPagefileBytes=$peakCommit; samples=$samples; rows=$rows; vCalls=$called }
        $measurements += $m
        $m | ConvertTo-Json -Compress | Write-Output
        $p.Dispose()
    }
}
if ($BatchComparison) {
    if (-not $allBatchIds.SetEquals($idsByCount[10000])) { throw 'Batch outputs do not cover the whole input exactly once' }
    $combinedIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $reader = [IO.File]::OpenText($mergedPath)
    try {
        $headerLine = $reader.ReadLine()
        if ($headerLine -ne $expectedHeader) { throw 'Combined AIRR header differs from whole output' }
        $header = $headerLine -split "`t"
        $idCol = [Array]::IndexOf($header, 'sequence_id')
        $vCol = [Array]::IndexOf($header, 'v_call')
        $called = 0
        while (($line = $reader.ReadLine()) -ne $null) {
            $fields = $line -split "`t", 0, 'SimpleMatch'
            if ($fields.Count -ne $header.Count -or -not $combinedIds.Add($fields[$idCol])) { throw 'Combined AIRR output has malformed or duplicate rows' }
            if (-not $wholeRows.ContainsKey($fields[$idCol]) -or $wholeRows[$fields[$idCol]] -cne $line) {
                throw "Combined AIRR row differs from whole output: $($fields[$idCol])"
            }
            if ($fields[$vCol]) { $called++ }
        }
        if (-not $combinedIds.SetEquals($idsByCount[10000]) -or $combinedIds.Count -ne 10000 -or $called -ne 10000) {
            throw 'Combined AIRR output has invalid IDs or incomplete V calls'
        }
        $batchValidation = [ordered]@{
            wholeRows = $wholeRows.Count
            combinedRows = $combinedIds.Count
            uniqueIds = $combinedIds.Count
            nonemptyVCalls = $called
            allFieldsMatchWholeOutput = $true
        }
    } finally { $reader.Dispose() }
}
$hashFiles = @($exe, $source) + @('Homo_sapiens_IGH_VDJ.ndm', 'Homo_sapiens_IGH_VDJ.aux', 'Homo_sapiens_IGH_VDJ_V.fasta', 'Homo_sapiens_IGH_VDJ_D.fasta', 'Homo_sapiens_IGH_VDJ_J.fasta' | ForEach-Object { Join-Path $artifacts $_ })
$hashes = @{}
foreach ($file in $hashFiles) { $hashes[$file] = (Get-FileHash $file -Algorithm SHA256).Hash }
$summary = [ordered]@{ artifacts=$artifacts; database=$database; executable=$exe; source=$source; sha256=$hashes; batchComparison=[bool]$BatchComparison; batchValidation=$batchValidation; measurements=$measurements }
$summary | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $runDir 'summary.json')
Write-Output "Summary: $runDir\summary.json"
