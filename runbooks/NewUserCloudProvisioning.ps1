Param(
     [parameter (Mandatory=$true)]
     [String]$data,
     [parameter (Mandatory=$true)]
     [Boolean]$fulltime,
     [parameter (Mandatory=$true)]
     [String]$department
)

#Write-Out $data


$kingsnetworkid = Get-AutomationVariable -Name 'Graph-KingsNetworkGroupId'
$appid = Get-AutomationVariable -Name 'Graph-ClientId'
$secret = Get-AutomationVariable -Name 'Graph-ClientSecret'
$tenantId = Get-AutomationVariable -Name 'AzureAD-TenantId'
$secretid = ConvertTo-SecureString $secret -AsPlainText -Force
$clientsecretcred = New-Object -TypeName System.Management.Automation.PSCredential -Argumentlist $appid,$secretid

$dataarr = $data -split '@'
if ($dataarr[0].length -ne 0 -and $dataarr[1].length -ne 0) {

    Connect-MgGraph -ClientSecretCredential $clientsecretcred -TenantId $tenantId
    $e5Sku = Get-MgSubscribedSku -All | Where SkuPartNumber -eq 'SPE_E5'
    $vivaSku = Get-MgSubscribedSku -All | Where SkuPartNumber -eq 'Viva_Connection_Mini_Bundle'

    $sig_groupid = (Get-MgGroup -All | Where {$_.DisplayName -eq $sig_group}).Id

    $userid = (Get-MgUser -UserId $data).Id
    Update-MgUser -UserId $data -UsageLocation US
    
    if ($fulltime -and $department -ne "Rivercats") {
        $addLicenses = @(
            @{SkuId = $e5Sku.SkuId},
            @{SkuId = $vivaSku.SkuId}
        )
        Set-MgUserLicense -UserId $data -AddLicenses $addLicenses -RemoveLicenses @()
        New-MgGroupMember -GroupId $kingsnetworkid -DirectoryObjectId $userid
    #    New-MgGroupMember -GroupId $sig_groupid -DirectoryObjectId $userid
        
    } else {
        Set-MgUserLicense -UserId $data -AddLicenses @{SkuId = $e5Sku.SkuId} -RemoveLicenses @()
    }
    Disconnect-MgGraph

}
