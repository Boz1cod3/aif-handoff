Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

# Single-instance enforcement using Mutex
$mutexName = "Global\HandoffAILauncherMutex_2026"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    try {
        Add-Type -Name Win32Utils -Namespace WindowUtils -MemberDefinition '
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(System.IntPtr hWnd);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint="FindWindow")]
        public static extern System.IntPtr FindWindow(string lpClassName, string lpWindowName);
        ' -ErrorAction SilentlyContinue
        $hWnd = [WindowUtils.Win32Utils]::FindWindow($null, "Handoff Control Panel")
        if ($hWnd -ne [System.IntPtr]::Zero) {
            [WindowUtils.Win32Utils]::ShowWindow($hWnd, 9) | Out-Null
            [WindowUtils.Win32Utils]::SetForegroundWindow($hWnd) | Out-Null
        }
    } catch {}
    exit 0
}

# Hide black console window
try {
    Add-Type -Name ConsoleHider -Namespace ConsoleUtils -MemberDefinition '
    [System.Runtime.InteropServices.DllImport("Kernel32.dll")]
    public static extern System.IntPtr GetConsoleWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
    ' -ErrorAction SilentlyContinue
    $consolePtr = [ConsoleUtils.ConsoleHider]::GetConsoleWindow()
    if ($consolePtr -and $consolePtr -ne [System.IntPtr]::Zero) {
        [ConsoleUtils.ConsoleHider]::ShowWindow($consolePtr, 0) | Out-Null
    }
} catch {}

$repoDir = (Split-Path -Parent $PSScriptRoot)
$ctlScript = Join-Path $PSScriptRoot "handoff-ctl.ps1"

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Handoff Control Panel"
        Height="470" Width="470"
        WindowStartupLocation="CenterScreen"
        ResizeMode="CanMinimize"
        Background="#0f1117"
        Foreground="#f3f4f6"
        FontFamily="Segoe UI">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Foreground" Value="#ffffff"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Padding" Value="14,10"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="border"
                                Background="{TemplateBinding Background}"
                                CornerRadius="8"
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter Property="Opacity" TargetName="border" Value="0.88"/>
                            </Trigger>
                            <Trigger Property="IsEnabled" Value="False">
                                <Setter Property="Opacity" TargetName="border" Value="0.30"/>
                                <Setter Property="Cursor" Value="Arrow"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- Header -->
        <StackPanel Grid.Row="0" Margin="0,0,0,18">
            <TextBlock Text="HANDOFF AI" FontSize="20" FontWeight="Bold" Foreground="#38bdf8"/>
            <TextBlock Text="Панель керування автономною системою задач" FontSize="12" Foreground="#94a3b8" Margin="0,3,0,0"/>
        </StackPanel>

        <!-- Status Card -->
        <Border Grid.Row="1" Background="#181c26" BorderBrush="#262d3d" BorderThickness="1" CornerRadius="12" Padding="18,16" Margin="0,0,0,20">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <StackPanel Grid.Column="0">
                    <TextBlock x:Name="StatusText" Text="Перевірка статусу..." FontSize="16" FontWeight="Bold" Foreground="#f3f4f6"/>
                    <TextBlock x:Name="PortsText" Text="Web: 5180  |  API: 3009  |  MCP: 3100" FontSize="11" Foreground="#64748b" Margin="0,5,0,0"/>
                </StackPanel>
                <Border x:Name="StatusBadge" Grid.Column="1" Background="#334155" CornerRadius="12" Width="18" Height="18" VerticalAlignment="Center" HorizontalAlignment="Right">
                    <Ellipse x:Name="StatusDot" Fill="#94a3b8" Width="10" Height="10"/>
                </Border>
            </Grid>
        </Border>

        <!-- Action Buttons -->
        <StackPanel Grid.Row="2" VerticalAlignment="Top">
            <Grid Margin="0,0,0,12">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="10"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>
                
                <Button x:Name="BtnStart" Grid.Column="0" Content="▶  Запустити" Background="#10b981" Height="44"/>
                <Button x:Name="BtnStop" Grid.Column="2" Content="⏹  Зупинити" Background="#ef4444" Height="44"/>
            </Grid>

            <Button x:Name="BtnOpenBrowser" Content="🌐  Відкрити Handoff у браузері" Background="#3b82f6" Height="44" Margin="0,0,0,12"/>

            <Grid Margin="0,0,0,8">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="10"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>
                
                <Button x:Name="BtnRestart" Grid.Column="0" Content="🔄  Перезапустити" Background="#262d3d" Height="38"/>
                <Button x:Name="BtnLogs" Grid.Column="2" Content="📋  Переглянути логи" Background="#262d3d" Height="38"/>
            </Grid>
        </StackPanel>

        <!-- Footer / Notification -->
        <Border Grid.Row="3" Margin="0,8,0,0" Padding="4">
            <TextBlock x:Name="FooterText" Text="Готово до роботи" FontSize="11" Foreground="#94a3b8" TextAlignment="Center"/>
        </Border>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$StatusText = $window.FindName("StatusText")
$PortsText = $window.FindName("PortsText")
$StatusDot = $window.FindName("StatusDot")
$BtnStart = $window.FindName("BtnStart")
$BtnStop = $window.FindName("BtnStop")
$BtnOpenBrowser = $window.FindName("BtnOpenBrowser")
$BtnRestart = $window.FindName("BtnRestart")
$BtnLogs = $window.FindName("BtnLogs")
$FooterText = $window.FindName("FooterText")

# Transition state machine variables
$script:desiredState = $null
$script:transitionStartTime = [DateTime]::MinValue

function Check-Status-Quiet {
    $conns = @(Get-NetTCPConnection -LocalPort 5180, 3009 -State Listen -ErrorAction SilentlyContinue)
    return ($conns.Count -gt 0)
}

function Update-UIState {
    param([bool]$isRunning, [string]$statusNote = "")
    if ($isRunning) {
        $StatusText.Text = "Сервер працює"
        $StatusText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#34d399")
        $StatusDot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#10b981")
        $BtnStart.IsEnabled = $false
        $BtnStop.IsEnabled = $true
        $BtnOpenBrowser.IsEnabled = $true
        $BtnRestart.IsEnabled = $true
        if (-not $statusNote) {
            $FooterText.Text = "Доступно на http://localhost:5180"
        } else {
            $FooterText.Text = $statusNote
        }
    } else {
        $StatusText.Text = "Сервер зупинено"
        $StatusText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#f87171")
        $StatusDot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#ef4444")
        $BtnStart.IsEnabled = $true
        $BtnStop.IsEnabled = $false
        $BtnOpenBrowser.IsEnabled = $false
        $BtnRestart.IsEnabled = $false
        if (-not $statusNote) {
            $FooterText.Text = "Натисніть 'Запустити' для старту"
        } else {
            $FooterText.Text = $statusNote
        }
    }
}

# Timer for periodic check (1.2 seconds, non-blocking)
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(1200)
$timer.Add_Tick({
    $running = Check-Status-Quiet

    if ($script:desiredState -eq "start") {
        if ($running) {
            $script:desiredState = $null
            Update-UIState -isRunning $true -statusNote "Сервер успішно запущено!"
        } elseif (([DateTime]::UtcNow - $script:transitionStartTime).TotalSeconds -gt 25) {
            $script:desiredState = $null
            Update-UIState -isRunning $false -statusNote "Таймаут запуску. Перевірте логи."
        } else {
            # Still starting...
            $elapsed = [int]([DateTime]::UtcNow - $script:transitionStartTime).TotalSeconds
            $FooterText.Text = "Запуск процесів... ($elapsed с)"
        }
    } elseif ($script:desiredState -eq "stop") {
        if (-not $running) {
            $script:desiredState = $null
            Update-UIState -isRunning $false -statusNote "Сервер зупинено та порти звільнено."
        } elseif (([DateTime]::UtcNow - $script:transitionStartTime).TotalSeconds -gt 15) {
            $script:desiredState = $null
            Update-UIState -isRunning $running -statusNote "Зупинку завершено."
        } else {
            # Still stopping...
            $elapsed = [int]([DateTime]::UtcNow - $script:transitionStartTime).TotalSeconds
            $FooterText.Text = "Зупинка процесів... ($elapsed с)"
        }
    } else {
        Update-UIState -isRunning $running
    }
})

# Button Handlers - fully asynchronous, zero UI blocking!
$BtnStart.Add_Click({
    $script:desiredState = "start"
    $script:transitionStartTime = [DateTime]::UtcNow
    
    $StatusText.Text = "Запуск серверів..."
    $StatusText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#fbbf24")
    $StatusDot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#f59e0b")
    $FooterText.Text = "Запуск фонових процесів, зачекайте кілька секунд..."
    
    $BtnStart.IsEnabled = $false
    $BtnStop.IsEnabled = $false
    $BtnRestart.IsEnabled = $false
    $BtnOpenBrowser.IsEnabled = $false

    # Start detached background process
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$ctlScript`" -Action start" `
        -WindowStyle Hidden
})

$BtnStop.Add_Click({
    $script:desiredState = "stop"
    $script:transitionStartTime = [DateTime]::UtcNow

    $StatusText.Text = "Зупинка серверів..."
    $StatusText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#fbbf24")
    $StatusDot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#f59e0b")
    $FooterText.Text = "Зупинка процесів та звільнення портів..."

    $BtnStart.IsEnabled = $false
    $BtnStop.IsEnabled = $false
    $BtnRestart.IsEnabled = $false
    $BtnOpenBrowser.IsEnabled = $false

    # Stop detached background process
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$ctlScript`" -Action stop" `
        -WindowStyle Hidden
})

$BtnOpenBrowser.Add_Click({
    Start-Process "http://localhost:5180"
})

$BtnRestart.Add_Click({
    $script:desiredState = "start"
    $script:transitionStartTime = [DateTime]::UtcNow

    $StatusText.Text = "Перезапуск серверів..."
    $StatusText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#fbbf24")
    $StatusDot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#f59e0b")
    $FooterText.Text = "Перезапуск фонових процесів..."

    $BtnStart.IsEnabled = $false
    $BtnStop.IsEnabled = $false
    $BtnRestart.IsEnabled = $false
    $BtnOpenBrowser.IsEnabled = $false

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$ctlScript`" -Action restart" `
        -WindowStyle Hidden
})

$BtnLogs.Add_Click({
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$ctlScript`" -Action logs" `
        -WindowStyle Hidden
})

# Initial state and activation
$window.Add_Loaded({
    $window.Activate()
})
$initial = Check-Status-Quiet
Update-UIState -isRunning $initial
$timer.Start()

try {
    $window.ShowDialog() | Out-Null
} catch {
    [System.Windows.MessageBox]::Show($_.Exception.ToString(), "Handoff Launcher Error", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error)
} finally {
    $timer.Stop()
    if ($mutex) {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
